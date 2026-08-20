# Theme Color Migration Guide

## 🎨 How to Use

### 1. UnoCSS Utility Classes (Recommended) ✨

```tsx
// ✅ Backgrounds - short and obvious
<div className="bg-base">     // Main background (white/black)
<div className="bg-1">        // Secondary background (#F7F8FA)
<div className="bg-2">        // Tertiary background (#F2F3F5)
<div className="bg-brand">    // Brand background (#7583B2)

// ✅ Text colors - semantic
<div className="text-t-primary">    // Primary text (#1D2129)
<div className="text-t-secondary">  // Secondary text (#86909C)
<div className="text-brand">        // Brand text

// ✅ Border colors
<div className="border-b-base">     // Base border (#E5E6EB)
<div className="border-b-light">    // Light border

// ✅ Brand color scale
<div className="bg-aou-1">           // AOU palette 1-10
<div className="hover:bg-brand-hover"> // Brand hover
```

### 2. Inline Styles (CSS Variables)

```tsx
<div style={{ backgroundColor: 'var(--bg-base)' }}>
<div style={{ color: 'var(--text-primary)' }}>
<div style={{ borderColor: 'var(--border-base)' }}>
<div style={{ backgroundColor: 'var(--brand)' }}>
```

## 📋 Common Color Mappings

| Old value (hex) | UnoCSS class                  | CSS variable            | Meaning                   |
| --------------- | ----------------------------- | ----------------------- | ------------------------- |
| `#FFFFFF`       | `bg-base`                     | `var(--bg-base)`        | Main background           |
| `#F7F8FA`       | `bg-1`                        | `var(--bg-1)`           | Secondary background/fill |
| `#F2F3F5`       | `bg-2`                        | `var(--bg-2)`           | Tertiary background       |
| `#E5E6EB`       | `bg-3` or `border-b-base`     | `var(--border-base)`    | Border/divider            |
| `#7583B2`       | `bg-brand` / `text-brand`     | `var(--brand)`          | Brand color               |
| `#EFF0F6`       | `bg-aou-1` / `bg-brand-light` | `var(--aou-1)`          | Light brand background    |
| `#E5E7F0`       | `bg-aou-2`                    | `var(--aou-2)`          | AOU palette 2             |
| `#1D2129`       | `text-t-primary`              | `var(--text-primary)`   | Primary text              |
| `#86909C`       | `text-t-secondary` / `bg-6`   | `var(--text-secondary)` | Secondary text            |
| `#165DFF`       | `bg-primary` / `text-primary` | `var(--primary)`        | Primary accent            |

## 🔄 Migration Steps

1. **Search** for hardcoded colors: `bg-#`, `text-#`, `color-#`, `border-#`
2. **Look up** the corresponding theme variable
3. **Replace** it with the UnoCSS class
4. **Test** by toggling between light and dark themes

## 💡 Migration Example

### Before (hardcoded):

```tsx
<div className='bg-#EFF0F6 hover:bg-#E5E7F0'>
  <span className='text-#1D2129'>Text</span>
  <div className='border border-#E5E6EB'></div>
</div>
```

### After (theme variables):

```tsx
<div className='bg-aou-1 hover:bg-aou-2'>
  <span className='text-t-primary'>Text</span>
  <div className='border border-b-base'></div>
</div>
```

### Common patterns:

```tsx
// ❌ Avoid
<div className="bg-#F7F8FA text-#86909C border-#E5E6EB">

// ✅ Prefer
<div className="bg-1 text-t-secondary border-b-base">
```

## 🎯 Quick Reference

- **Backgrounds**: `bg-base`, `bg-1`, `bg-2`, `bg-3`
- **Text**: `text-t-primary`, `text-t-secondary`, `text-t-disabled`
- **Borders**: `border-b-base`, `border-b-light`
- **Brand**: `bg-brand`, `bg-brand-light`, `bg-brand-hover`
- **States**: `bg-primary`, `bg-success`, `bg-warning`, `bg-danger`
- **AOU palette**: `bg-aou-1` – `bg-aou-10`
