# Internationalization (i18n)

This project uses i18next and react-i18next for internationalization.

## Supported Languages

- English (en-US) — default and reference language

Languages and translation modules are declared in
`packages/desktop/src/common/config/i18n-config.json`.

## File Structure

```
src/renderer/services/i18n/
├── index.ts              # i18next configuration
├── i18n-keys.d.ts        # Generated key types (bun run i18n:types)
├── locales/
│   └── en-US/            # English translation modules
│       ├── index.ts      # Aggregates every module below
│       ├── common.json
│       └── ...           # One JSON file per module
└── README.md             # This document
```

## Usage

### Translating in a component

```tsx
import { useTranslation } from 'react-i18next';

const MyComponent = () => {
  const { t } = useTranslation();

  return (
    <div>
      <h1>{t('common.title')}</h1>
      <p>{t('common.description')}</p>
    </div>
  );
};
```

### Switching languages

```tsx
import { useTranslation } from 'react-i18next';

const LanguageSwitcher = () => {
  const { i18n } = useTranslation();

  const changeLanguage = (lng: string) => {
    i18n.changeLanguage(lng);
  };

  return <button onClick={() => changeLanguage('en-US')}>English</button>;
};
```

The selected language is persisted to `localStorage` and restored on the next
launch.

## Adding a New Translation

1. Add the key to the matching module under `locales/en-US/`
2. Regenerate the key types with `bun run i18n:types`
3. Reference it in your component with `t('key')`
4. Validate with `node scripts/check-i18n.js`

### Key Naming Convention

- Use a dot-separated hierarchy
- Use lowercase letters and underscores
- Group keys by feature module

For example:

```json
{
  "common": {
    "send": "Send",
    "cancel": "Cancel"
  },
  "conversation": {
    "welcome": {
      "title": "What's on the agenda today?"
    }
  }
}
```

## Notes

1. Every user-facing string must go through the translation function
2. Keys should be descriptive so they stay maintainable
3. Add new keys to every supported language, not just the reference one
4. Never hardcode user-facing text in components
