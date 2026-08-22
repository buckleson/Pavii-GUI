//! A database written by an engine built from a CRLF checkout must still open
//! in an engine built from LF, and vice versa.
//!
//! `sqlx::migrate!()` checksums the raw bytes of each `.sql` file, so the same
//! SQL hashes differently depending on line endings. That shipped: a Windows
//! working tree held CRLF copies of files git stores as LF, so a locally built
//! engine and a CI-built engine disagreed and the app died on launch with
//! "Local data migration failed", telling users to reinstall — which could not
//! help, because the schema was correct and only the fingerprint disagreed.
//!
//! `.gitattributes` pins `*.sql -text` so new divergence cannot occur, but
//! databases carrying the other checksums already exist. These tests pin the
//! in-place heal, and — just as importantly — that a genuinely edited migration
//! still refuses to open.

use aionui_db::{init_database, migrator_iter};
use sha2::{Digest, Sha384};
use sqlx::Row;
use sqlx::sqlite::SqlitePoolOptions;
use tempfile::TempDir;

async fn open(path: &std::path::Path) -> Result<(), String> {
    match init_database(path).await {
        Ok(db) => {
            db.close().await;
            Ok(())
        }
        Err(e) => Err(format!("{e:?}")),
    }
}

/// Rewrite every stored checksum to the CRLF rendering of its own SQL,
/// simulating a database created by an engine built from a CRLF checkout.
async fn rewrite_checksums_as_crlf(db_path: &std::path::Path) {
    let pool = SqlitePoolOptions::new()
        .connect(&format!("sqlite://{}", db_path.display()))
        .await
        .expect("reopen");
    let rows = sqlx::query("SELECT version FROM _sqlx_migrations")
        .fetch_all(&pool)
        .await
        .expect("read versions");
    for row in rows {
        let version: i64 = row.get("version");
        let Some(m) = migrator_iter().find(|m| m.version == version) else {
            continue;
        };
        let crlf = m.sql.replace("\r\n", "\n").replace('\n', "\r\n");
        let checksum = Sha384::digest(crlf.as_bytes()).to_vec();
        sqlx::query("UPDATE _sqlx_migrations SET checksum = ? WHERE version = ?")
            .bind(checksum)
            .bind(version)
            .execute(&pool)
            .await
            .expect("rewrite checksum");
    }
    pool.close().await;
}

#[tokio::test]
async fn opens_a_database_whose_checksums_use_the_other_line_endings() {
    let dir = TempDir::new().unwrap();
    let db = dir.path().join("heal.db");

    open(&db).await.expect("first open should succeed");
    rewrite_checksums_as_crlf(&db).await;

    // Without the heal this is exactly the shipped failure:
    // "migration N was previously applied but has been modified".
    open(&db)
        .await
        .expect("a line-ending-only checksum difference must heal, not fail");

    // And the heal must persist, so the next launch is clean too.
    open(&db).await.expect("second open after healing should succeed");
}

#[tokio::test]
async fn still_refuses_a_migration_whose_sql_actually_changed() {
    let dir = TempDir::new().unwrap();
    let db = dir.path().join("tamper.db");

    open(&db).await.expect("first open should succeed");

    let pool = SqlitePoolOptions::new()
        .connect(&format!("sqlite://{}", db.display()))
        .await
        .unwrap();
    // A checksum that corresponds to no line-ending rendering of the real SQL.
    sqlx::query("UPDATE _sqlx_migrations SET checksum = ? WHERE version = 1")
        .bind(Sha384::digest(b"DROP TABLE conversations;").to_vec())
        .execute(&pool)
        .await
        .unwrap();
    pool.close().await;

    let err = open(&db)
        .await
        .expect_err("a genuinely modified migration must still refuse to open");
    assert!(
        err.contains("migration") || err.contains("Migration"),
        "expected a migration error, got: {err}"
    );
}
