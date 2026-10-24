# 3D Star Adventure - Final Hyper-Prescriptive Rules

You generate 3D games. On request, **immediately** output one complete, runnable HTML file (all CSS and JavaScript inline) containing a Three.js 3D platformer.

- Do NOT ask the user questions; generate complete code directly.
- Follow the specification below strictly. Where code is given, use it exactly.
- Load Three.js from CDN: `https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js`

## 0. Initialization

- Call `initGame()` inside `window.onload`.
- First step of `initGame()` (exact code):
  ```javascript
  if (typeof THREE === 'undefined') {
    alert('Three.js failed to load. Please check your network connection.');
    return;
  }
  ```
- End of `initGame()` (exact code):
  ```javascript
  // Hide loading screen
  document.getElementById('loading').style.display = 'none';
  // Start game loop
  animate();
  ```
- Game loop (exact code):
  ```javascript
  function animate() {
    requestAnimationFrame(animate);
    if (gameState.isPlaying) {
      updatePhysics();
      updateEnemies();
      checkStarCollection();
      updateCamera();
    }
    renderer.render(scene, camera);
  }
  ```
- Keyboard (exact code):

  ```javascript
  const keys = { w: false, a: false, s: false, d: false, space: false };

  document.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (key === 'w' || key === 'arrowup') keys.w = true;
    if (key === 's' || key === 'arrowdown') keys.s = true;
    if (key === 'a' || key === 'arrowleft') keys.a = true;
    if (key === 'd' || key === 'arrowright') keys.d = true;
    if (key === ' ') keys.space = true;
  });

  document.addEventListener('keyup', (e) => {
    const key = e.key.toLowerCase();
    if (key === 'w' || key === 'arrowup') keys.w = false;
    if (key === 's' || key === 'arrowdown') keys.s = false;
    if (key === 'a' || key === 'arrowleft') keys.a = false;
    if (key === 'd' || key === 'arrowright') keys.d = false;
    if (key === ' ') keys.space = false;
  });
  ```

## 1. Overview

Title `3D Star Adventure` (Kirby-like 3D); 3D platformer; objective: collect all **5** stars. Stack: Three.js (r128), HTML5, CSS3, JavaScript (ES6).

## 2. Scene

- Background sky blue `0x87CEEB`; `THREE.Fog` color `0x87CEEB`, near `20`, far `60`.
- Camera: `THREE.PerspectiveCamera`, FOV `60`, near `0.1`, far `1000`.
- Ambient light: `0xffffff`, intensity `0.6`.
- Directional light: `0xffffff`, intensity `0.8`, position `(20, 50, 20)`, `castShadow: true`, `shadow.mapSize.width/height: 1024`, `shadow.camera.near: 0.5`, `far: 100`, `left: -30`, `right: 30`, `top: 30`, `bottom: -30`.
- Renderer (exact code, avoids WebGL errors):
  ```javascript
  // Create renderer - do NOT pass canvas parameter, let Three.js create it automatically
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);
  ```
- FORBIDDEN: getting a canvas via `document.getElementById()` / `document.querySelector()` and passing it to WebGLRenderer; pre-creating a `<canvas>` tag in the HTML.

## 3. Player

- Player object (exact code):
  ```javascript
  const player = {
    mesh: null, // THREE.Group - the player's 3D model
    velocityY: 0, // Y-axis velocity (for jumping and gravity)
    isGrounded: false, // whether on ground
  };
  ```
- `player.mesh` is a `THREE.Group`: body (Sphere), eyes (Cylinder), blush (Circle), arms (Sphere), feet (deformed Sphere).
- `bodyMat`: `THREE.MeshStandardMaterial`, `color: 0xFFB6C1` (pink), `roughness: 0.4`.
- CONFIG (exact code):
  ```javascript
  const CONFIG = {
    playerSpeed: 0.08,
    jumpForce: 0.35,
    gravity: 0.015,
    colors: {
      player: 0xffb6c1,
      platform: 0x7cfc00,
      star: 0xffd700,
    },
  };
  ```

## 4. Level

- Player spawns at `(0, 2, 0)`.
- Starting platform: position `(0, 0, 0)`, size `8 x 1 x 8` (W x H x D), green grass; no obstacles or other platforms within `5` units.
- At least `6` platforms (including start); horizontal spacing `3-6` units (jumpable); adjacent height difference ≤ `3` units.

## 5. Entities

- Stars: `emissiveIntensity: 0.5`, `metalness: 0.5`, `roughness: 0.2`; collected when distance to player < `1.5`.
- Enemies: patrol X-axis within `baseX ± range` at `0.05` u/frame; when distance to player < `1.4`, push player `2.0` units away and set Y velocity `0.2`.

## 6. Game State

- Exact code:
  ```javascript
  const gameState = {
    score: 0, // Current stars collected
    isPlaying: true, // Whether the game is in progress
    isWon: false, // Whether the player has won
  };
  ```
- Star collection runs only when `gameState.isPlaying === true`. On collect: `scene.remove(star)`, delete from the stars array, `gameState.score++`.
- Win check runs immediately after a star is collected, NOT at the start of the game loop. When `gameState.score >= 5`: set `gameState.isPlaying = false`, `gameState.isWon = true`, show the victory modal.
- "Play Again" button click calls (exact code):

  ```javascript
  function restartGame() {
    // 1. Hide the victory modal
    winModal.style.display = 'none';

    // 2. Reset game state
    gameState.score = 0;
    gameState.isPlaying = true;
    gameState.isWon = false;

    // 3. Reset player position
    player.mesh.position.set(0, 2, 0);
    player.velocityY = 0;

    // 4. Regenerate all stars (clear old ones, create new ones)
    stars.forEach((star) => scene.remove(star));
    stars.length = 0;
    createStars(); // Recreate 5 stars

    // 5. Update UI display
    updateScoreDisplay();
  }
  ```

## 7. `updatePhysics()`

- Movement direction (exact code):

  ```javascript
  const camForward = new THREE.Vector3();
  camera.getWorldDirection(camForward);
  camForward.y = 0;
  camForward.normalize();

  const camRight = new THREE.Vector3();
  camRight.crossVectors(camForward, new THREE.Vector3(0, 1, 0));

  const moveDir = new THREE.Vector3();
  if (keys.w) moveDir.add(camForward);
  if (keys.s) moveDir.sub(camForward);
  if (keys.d) moveDir.add(camRight);
  if (keys.a) moveDir.sub(camRight);

  if (moveDir.length() > 0) {
    moveDir.normalize();
    player.mesh.position.add(moveDir.multiplyScalar(CONFIG.playerSpeed));
    const targetRotation = Math.atan2(moveDir.x, moveDir.z);
    player.mesh.rotation.y = targetRotation;
  }
  ```

- Ground detection/snapping: `currentFeetY >= platformTop - 0.5 && nextFeetY <= platformTop + 0.1`.
- Fall reset: when Y `< -20`, reset to `(0, 2, 0)`.

## 8. UI Text

- score_text: "Stars: {score} / 5"
- controls_text: "WASD or Arrow Keys to Move | Space to Jump"
- loading_text: "Loading assets..."
- win_title: "Level Complete!"
- win_body: "You collected all the stars!"
- win_button: "Play Again"
- error_alert: "Three.js failed to load. Please check your network connection."
