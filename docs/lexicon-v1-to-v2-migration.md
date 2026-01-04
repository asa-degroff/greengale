# GreenGale Lexicon Migration: V1 to V2

This document details the changes between GreenGale's V1 lexicon (`app.greengale.blog.entry`) and V2 lexicon (`app.greengale.document`), including the new publication lexicon (`app.greengale.publication`).

## Overview

The V2 lexicon introduces compatibility with the [site.standard](https://standard.site) ecosystem, enabling interoperability with other AT Protocol long-form publishing platforms. The key changes add publication-level metadata and document discoverability fields.

## Collection Namespaces

| Version | Collection | Description |
|---------|------------|-------------|
| V1 | `app.greengale.blog.entry` | Original GreenGale blog entry format |
| V2 | `app.greengale.document` | site.standard compatible document format |
| V2 | `app.greengale.publication` | Publication/blog configuration (new) |

GreenGale also maintains read compatibility with `com.whtwnd.blog.entry` (WhiteWind format).

## Schema Changes

### Document Record (`app.greengale.document`)

#### New Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `url` | `string (uri)` | Base publication URL (e.g., `https://greengale.app`) |
| `path` | `string` | Document path relative to publication URL (e.g., `/@handle/rkey`) |

#### Renamed Fields

| V1 Field | V2 Field | Notes |
|----------|----------|-------|
| `createdAt` | `publishedAt` | Aligns with site.standard terminology |

#### Changed Fields

| Field | V1 | V2 | Notes |
|-------|----|----|-------|
| `title` | optional | **required** | Required per site.standard spec |
| `publishedAt` | optional (as `createdAt`) | **required** | Required per site.standard spec |

#### Unchanged Fields

These fields remain identical between V1 and V2:

- `content` (string, required) - Markdown content
- `subtitle` (string, optional) - Document subtitle
- `theme` (ref) - Theme configuration
- `visibility` (enum: public/url/author) - Access control
- `ogp` (ref) - OpenGraph metadata
- `blobs` (array) - Uploaded file references
- `latex` (boolean) - LaTeX rendering flag

### V1 Schema

```json
{
  "id": "app.greengale.blog.entry",
  "record": {
    "required": ["content"],
    "properties": {
      "content": { "type": "string", "maxLength": 100000 },
      "title": { "type": "string", "maxLength": 1000 },
      "subtitle": { "type": "string", "maxLength": 1000 },
      "createdAt": { "type": "string", "format": "datetime" },
      "theme": { "ref": "app.greengale.blog.defs#theme" },
      "visibility": { "enum": ["public", "url", "author"] },
      "ogp": { "ref": "app.greengale.blog.defs#ogp" },
      "blobs": { "type": "array" },
      "latex": { "type": "boolean" }
    }
  }
}
```

### V2 Schema

```json
{
  "id": "app.greengale.document",
  "record": {
    "required": ["content", "url", "path", "title", "publishedAt"],
    "properties": {
      "content": { "type": "string", "maxLength": 100000 },
      "url": { "type": "string", "format": "uri" },
      "path": { "type": "string", "maxLength": 500 },
      "title": { "type": "string", "maxLength": 1000 },
      "subtitle": { "type": "string", "maxLength": 1000 },
      "publishedAt": { "type": "string", "format": "datetime" },
      "theme": { "ref": "app.greengale.blog.defs#theme" },
      "visibility": { "enum": ["public", "url", "author"] },
      "ogp": { "ref": "app.greengale.blog.defs#ogp" },
      "blobs": { "type": "array" },
      "latex": { "type": "boolean" }
    }
  }
}
```

## Publication Record (New in V2)

The `app.greengale.publication` lexicon is a singleton record (rkey: `self`) that stores blog-level configuration.

```json
{
  "id": "app.greengale.publication",
  "key": "self",
  "record": {
    "required": ["url", "name"],
    "properties": {
      "url": { "type": "string", "format": "uri" },
      "name": { "type": "string", "maxLength": 200 },
      "description": { "type": "string", "maxLength": 1000 },
      "theme": { "ref": "app.greengale.blog.defs#theme" }
    }
  }
}
```

### Publication Features

- **Default Theme**: Posts without explicit themes inherit the publication theme
- **Theme Inheritance**: Post theme > Publication theme > Site default
- **Single Record**: Uses `self` as rkey (one publication per user)

## Migration Behavior

### Automatic Migration

When a user edits an existing V1 post (`app.greengale.blog.entry`) in GreenGale:

1. The V1 record is deleted from the user's PDS
2. A new V2 record (`app.greengale.document`) is created with the same rkey
3. The original `createdAt` timestamp is preserved as `publishedAt`
4. New required fields (`url`, `path`) are populated automatically

### Reading Posts

GreenGale reads from all three collections in priority order:

1. `app.greengale.document` (V2)
2. `app.greengale.blog.entry` (V1)
3. `com.whtwnd.blog.entry` (WhiteWind)

The `createdAt` field in the internal `BlogEntry` interface is populated from:
- `publishedAt` for V2 documents
- `createdAt` for V1 and WhiteWind posts

### New Posts

All new posts are created using the V2 document format. WhiteWind compatibility mode continues to use `com.whtwnd.blog.entry`.

## site.standard Compatibility

The V2 format aligns with [site.standard](https://standard.site) conventions:

| site.standard | GreenGale V2 | Notes |
|---------------|--------------|-------|
| `site.standard.document` | `app.greengale.document` | Similar structure, custom namespace |
| `site.standard.publication` | `app.greengale.publication` | Similar structure, custom namespace |
| `url` field | `url` field | Base publication URL |
| `path` field | `path` field | Document path |
| `publishedAt` field | `publishedAt` field | Publication timestamp |

### Why Custom Namespace?

GreenGale uses `app.greengale.*` rather than `site.standard.*` to:
- Maintain control over schema evolution
- Support GreenGale-specific fields (e.g., `latex`, custom theme format)
- Allow gradual adoption of site.standard conventions

## Code References

Key implementation files:

- `lexicons/app/greengale/document.json` - V2 document schema
- `lexicons/app/greengale/publication.json` - Publication schema
- `lexicons/app/greengale/blog/entry.json` - V1 document schema (legacy)
- `src/lib/atproto.ts` - Collection constants and reading logic
- `src/pages/Editor.tsx:505-540` - V1→V2 migration logic

## Backward Compatibility

- **V1 posts remain readable**: The reader checks V1 collection as fallback
- **WhiteWind posts remain readable**: Full compatibility maintained
- **V1 posts are migrated on edit**: Editing triggers automatic migration
- **No data loss**: Original timestamps and content are preserved
