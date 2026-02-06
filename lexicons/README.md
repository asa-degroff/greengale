# GreenGale Lexicon Schemas

GreenGale uses [AT Protocol Lexicons](https://atproto.com/specs/lexicon) to define its data schemas. Posts and publications are stored in users' Personal Data Servers (PDS), enabling decentralized ownership and cross-platform interoperability.

## Collections

| Collection | Key | Description |
|-----------|-----|-------------|
| `app.greengale.document` | `tid` | Blog posts (current format) |
| `app.greengale.publication` | `literal:self` | Publication configuration (one per user) |
| `site.standard.document` | `tid` | Cross-platform blog posts (dual-published) |
| `site.standard.publication` | `tid` | Cross-platform publication metadata |

## app.greengale.document

A markdown document with extended theme, image, and LaTeX support. This is the primary record type for blog posts.

**Required fields:** `content`, `url`, `path`, `title`, `publishedAt`

```json
{
  "lexicon": 1,
  "id": "app.greengale.document",
  "defs": {
    "contentRef": {
      "type": "object",
      "description": "Reference to external content via AT-URI. Used in site.standard.document content union.",
      "required": ["uri"],
      "properties": {
        "uri": {
          "type": "string",
          "format": "at-uri",
          "description": "AT-URI pointing to the full document content"
        }
      }
    },
    "main": {
      "type": "record",
      "description": "A markdown document with extended theme and LaTeX support.",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["content", "url", "path", "title", "publishedAt"],
        "properties": {
          "content": {
            "type": "string",
            "maxLength": 1000000,
            "description": "Markdown content of the document"
          },
          "url": {
            "type": "string",
            "format": "uri",
            "maxLength": 2048,
            "description": "Base publication URL (e.g., https://greengale.app)"
          },
          "path": {
            "type": "string",
            "maxLength": 500,
            "description": "Document path relative to the publication URL (e.g., /handle/rkey)"
          },
          "title": {
            "type": "string",
            "maxLength": 1000,
            "description": "Document title"
          },
          "subtitle": {
            "type": "string",
            "maxLength": 1000
          },
          "publishedAt": {
            "type": "string",
            "format": "datetime",
            "description": "Publication timestamp"
          },
          "theme": {
            "type": "ref",
            "ref": "app.greengale.blog.defs#theme"
          },
          "visibility": {
            "type": "string",
            "enum": ["public", "url", "author"],
            "default": "public",
            "description": "Controls who can view this document"
          },
          "ogp": {
            "type": "ref",
            "ref": "app.greengale.blog.defs#ogp"
          },
          "blobs": {
            "type": "array",
            "items": {
              "type": "ref",
              "ref": "app.greengale.blog.defs#blobMetadata"
            }
          },
          "latex": {
            "type": "boolean",
            "default": false,
            "description": "Legacy field. LaTeX is now always enabled."
          },
          "tags": {
            "type": "array",
            "maxLength": 100,
            "items": {
              "type": "string",
              "maxLength": 100,
              "maxGraphemes": 50
            },
            "description": "Tags to categorize the document. Avoid prepending with hashtags."
          }
        }
      }
    }
  }
}
```

### Field Details

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `content` | string | Yes | Markdown body (max 1,000,000 UTF-8 bytes) |
| `url` | uri | Yes | Base publication URL |
| `path` | string | Yes | Path relative to publication URL |
| `title` | string | Yes | Document title (max 1,000 chars) |
| `subtitle` | string | No | Subtitle (max 1,000 chars) |
| `publishedAt` | datetime | Yes | Publication timestamp |
| `theme` | ref | No | Theme preset or custom colors |
| `visibility` | enum | No | `public` (default), `url`, or `author` |
| `ogp` | ref | No | Open Graph image metadata |
| `blobs` | array | No | Embedded image references |
| `latex` | boolean | No | Legacy field (always enabled) |
| `tags` | array | No | Categorization tags |

### contentRef

Used in `site.standard.document`'s `content` union to reference the full GreenGale document by AT-URI, avoiding content duplication across collections.

## app.greengale.publication

Publication-level configuration. Each user has at most one record (key: `literal:self`).

**Required fields:** `url`, `name`

```json
{
  "lexicon": 1,
  "id": "app.greengale.publication",
  "defs": {
    "main": {
      "type": "record",
      "description": "A publication configuration with title, description, and default theme.",
      "key": "literal:self",
      "record": {
        "type": "object",
        "required": ["url", "name"],
        "properties": {
          "url": {
            "type": "string",
            "format": "uri",
            "maxLength": 2048,
            "description": "Publication base URL (e.g., https://greengale.app)"
          },
          "name": {
            "type": "string",
            "maxLength": 200,
            "description": "Publication/blog title"
          },
          "description": {
            "type": "string",
            "maxLength": 1000,
            "description": "Publication description"
          },
          "theme": {
            "type": "ref",
            "ref": "app.greengale.blog.defs#theme",
            "description": "Default theme for posts in this publication"
          },
          "enableSiteStandard": {
            "type": "boolean",
            "default": false,
            "description": "When enabled, also publishes to site.standard collections for cross-platform compatibility"
          },
          "voiceTheme": {
            "type": "ref",
            "ref": "app.greengale.blog.defs#voiceTheme",
            "description": "Default voice settings for TTS playback on posts"
          }
        }
      }
    }
  }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | uri | Yes | Publication base URL |
| `name` | string | Yes | Publication/blog title (max 200 chars) |
| `description` | string | No | Publication description (max 1,000 chars) |
| `theme` | ref | No | Default theme for all posts |
| `enableSiteStandard` | boolean | No | Dual-publish to `site.standard.*` collections |
| `voiceTheme` | ref | No | Default TTS voice configuration |

## app.greengale.blog.defs

Shared type definitions referenced by documents and publications.

```json
{
  "lexicon": 1,
  "id": "app.greengale.blog.defs",
  "defs": {
    "theme": {
      "type": "object",
      "description": "Theme configuration for a blog entry",
      "properties": {
        "preset": {
          "type": "string",
          "enum": [
            "github-light", "github-dark", "dracula",
            "nord", "solarized-light", "solarized-dark", "monokai"
          ],
          "description": "Predefined color theme"
        },
        "custom": {
          "type": "ref",
          "ref": "#customColors",
          "description": "Custom color overrides"
        }
      }
    },
    "customColors": {
      "type": "object",
      "description": "Custom color values (CSS color strings)",
      "properties": {
        "background": { "type": "string", "maxLength": 64 },
        "text": { "type": "string", "maxLength": 64 },
        "accent": { "type": "string", "maxLength": 64 },
        "codeBackground": { "type": "string", "maxLength": 64 }
      }
    },
    "ogp": {
      "type": "object",
      "description": "Open Graph Protocol metadata for social sharing",
      "required": ["url"],
      "properties": {
        "url": { "type": "string", "format": "uri", "maxLength": 2048 },
        "width": { "type": "integer" },
        "height": { "type": "integer" }
      }
    },
    "blobMetadata": {
      "type": "object",
      "description": "Metadata for uploaded binary content",
      "required": ["blobref"],
      "properties": {
        "blobref": { "type": "blob", "accept": ["*/*"] },
        "name": { "type": "string", "maxLength": 256 },
        "alt": { "type": "string", "maxLength": 1000 },
        "labels": { "type": "ref", "ref": "#selfLabels" }
      }
    },
    "selfLabels": {
      "type": "object",
      "description": "Content labels published by the author",
      "required": ["values"],
      "properties": {
        "values": {
          "type": "array",
          "maxLength": 10,
          "items": { "type": "ref", "ref": "#selfLabel" }
        }
      }
    },
    "selfLabel": {
      "type": "object",
      "required": ["val"],
      "properties": {
        "val": { "type": "string", "maxLength": 128 }
      }
    },
    "voiceTheme": {
      "type": "object",
      "description": "Voice theme configuration for TTS playback",
      "properties": {
        "voice": { "type": "string", "maxLength": 32, "description": "Voice ID (e.g., 'af_heart', 'am_adam')" },
        "pitch": { "type": "integer", "description": "Pitch multiplier x100 (range 50-150)" },
        "speed": { "type": "integer", "description": "Speed multiplier x100 (range 50-200)" }
      }
    }
  }
}
```

### theme

A post or publication can use a `preset` name, `custom` colors, or both (custom overrides preset defaults).

| Preset | Description |
|--------|-------------|
| `github-light` | Light theme inspired by GitHub |
| `github-dark` | Dark theme inspired by GitHub |
| `dracula` | Dark purple theme |
| `nord` | Arctic, north-bluish palette |
| `solarized-light` | Warm light theme |
| `solarized-dark` | Warm dark theme |
| `monokai` | Dark theme with vivid accents |

### customColors

| Field | Description |
|-------|-------------|
| `background` | Page background color |
| `text` | Primary text color |
| `accent` | Link and accent color |
| `codeBackground` | Code block background color |

### blobMetadata

Attached to documents via the `blobs` array. Each entry references an image uploaded to the user's PDS.

### selfLabels

Content warning labels for images. Common values:
- `nudity` - Non-sexual nudity
- `sexual` - Sexually suggestive
- `porn` - Explicit content (18+)
- `graphic-media` - Violence or disturbing imagery

### voiceTheme

Controls default TTS voice for a publication. Voices are provided by the [Kokoro TTS](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) model.

**Voice ID format:** `{accent}{gender}_{name}` where accent is `a` (American) or `b` (British), and gender is `f` (female) or `m` (male).

| Category | Voice IDs |
|----------|-----------|
| American Female | `af_heart` (default), `af_alloy`, `af_aoede`, `af_bella`, `af_jessica`, `af_kore`, `af_nicole`, `af_nova`, `af_river`, `af_sarah`, `af_sky` |
| American Male | `am_adam`, `am_echo`, `am_eric`, `am_fenrir`, `am_liam`, `am_michael`, `am_onyx`, `am_puck`, `am_santa` |
| British Female | `bf_alice`, `bf_emma`, `bf_isabella`, `bf_lily` |
| British Male | `bm_daniel`, `bm_fable`, `bm_george`, `bm_lewis` |

**Pitch** and **speed** are integers representing the multiplier times 100 (e.g., `100` = 1.0x normal).

| Field | Available steps (x100) | Description |
|-------|------------------------|-------------|
| `pitch` | 50, 75, 90, **100**, 110, 125, 150 | Pitch multiplier (100 = normal) |
| `speed` | 50, 75, 90, **100**, 110, 125, 150, 200 | Playback speed multiplier (100 = normal) |

## site.standard.document

Cross-platform document record from the [standard.site](https://standard.site) specification. GreenGale dual-publishes to this collection when `enableSiteStandard` is enabled, using the same rkey as the `app.greengale.document` record.

**Required fields:** `site`, `title`, `publishedAt`

```json
{
  "lexicon": 1,
  "id": "site.standard.document",
  "defs": {
    "main": {
      "type": "record",
      "description": "A document record representing a published article, blog post, or other content. Documents can belong to a publication or exist independently.",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["site", "title", "publishedAt"],
        "properties": {
          "site": {
            "type": "string",
            "format": "uri",
            "description": "Points to a publication record (at://) or a publication url (https://) for loose documents. Avoid trailing slashes."
          },
          "path": {
            "type": "string",
            "description": "Combine with site or publication url to construct a canonical URL to the document. Prepend with a leading slash."
          },
          "title": {
            "type": "string",
            "maxLength": 5000,
            "maxGraphemes": 500
          },
          "description": {
            "type": "string",
            "maxLength": 30000,
            "maxGraphemes": 3000,
            "description": "A brief description or excerpt from the document."
          },
          "coverImage": {
            "type": "blob",
            "accept": ["image/*"],
            "maxSize": 1000000,
            "description": "Image for thumbnail or cover image. Less than 1MB in size."
          },
          "content": {
            "type": "union",
            "closed": false,
            "refs": [],
            "description": "Open union for content. GreenGale uses app.greengale.document#contentRef here."
          },
          "textContent": {
            "type": "string",
            "description": "Plaintext representation of document contents. Should not contain markdown or other formatting."
          },
          "bskyPostRef": {
            "type": "ref",
            "ref": "com.atproto.repo.strongRef",
            "description": "Strong reference to a Bluesky post. Useful to keep track of comments off-platform."
          },
          "tags": {
            "type": "array",
            "items": { "type": "string", "maxLength": 1280, "maxGraphemes": 128 },
            "description": "Tags to categorize the document. Avoid prepending with hashtags."
          },
          "publishedAt": {
            "type": "string",
            "format": "datetime"
          },
          "updatedAt": {
            "type": "string",
            "format": "datetime"
          }
        }
      }
    }
  }
}
```

### How GreenGale Uses site.standard.document

When dual-publishing, GreenGale populates the `content` field with a `contentRef` pointing to the corresponding `app.greengale.document` AT-URI. The `textContent` field is populated with a plaintext extraction of the markdown for search indexing.

## site.standard.publication

Cross-platform publication metadata from the standard.site specification.

**Required fields:** `url`, `name`

```json
{
  "lexicon": 1,
  "id": "site.standard.publication",
  "defs": {
    "main": {
      "type": "record",
      "description": "A publication record representing a blog, website, or content platform. Publications serve as containers for documents and define the overall branding and settings.",
      "key": "tid",
      "record": {
        "type": "object",
        "required": ["url", "name"],
        "properties": {
          "url": {
            "type": "string",
            "format": "uri",
            "description": "Base publication url (ex: https://standard.site). The canonical document URL is formed by combining this value with the document path."
          },
          "name": {
            "type": "string",
            "maxLength": 5000,
            "maxGraphemes": 500,
            "description": "Name of the publication."
          },
          "description": {
            "type": "string",
            "maxLength": 30000,
            "maxGraphemes": 3000,
            "description": "Brief description of the publication."
          },
          "icon": {
            "type": "blob",
            "accept": ["image/*"],
            "maxSize": 1000000,
            "description": "Square image to identify the publication. Should be at least 256x256."
          },
          "basicTheme": {
            "type": "ref",
            "ref": "site.standard.theme.basic",
            "description": "Simplified publication theme for tools and apps to utilize when displaying content."
          },
          "preferences": {
            "type": "ref",
            "ref": "#preferences",
            "description": "Object containing platform specific preferences (with a few shared properties)."
          }
        }
      }
    },
    "preferences": {
      "type": "object",
      "description": "Platform-specific preferences for the publication, including discovery and visibility settings.",
      "properties": {
        "showInDiscover": {
          "type": "boolean",
          "default": true,
          "description": "Boolean which decides whether the publication should appear in discovery feeds."
        }
      }
    }
  }
}
```

### Theme Conversion

GreenGale converts its theme format to `site.standard.theme.basic` (which uses `primaryColor`, `backgroundColor`, and `accentColor`). The full GreenGale theme is preserved in `preferences.greengale` for round-tripping.

## Mathematical Expressions

GreenGale posts support [KaTeX](https://katex.org/) math rendering via `remark-math` and `rehype-katex`. LaTeX is always enabled for all GreenGale posts.

**Inline math** — wrap expressions with single dollar signs:

```markdown
The quadratic formula is $x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$ for any quadratic equation.
```

**Display math** — wrap expressions with double dollar signs on their own lines:

```markdown
$$
\int_{-\infty}^{\infty} e^{-x^2} dx = \sqrt{\pi}
$$
```

To render a literal dollar sign without triggering math mode, escape it with a backslash: `\$`.

See the [KaTeX supported functions](https://katex.org/docs/supported) for a full reference of available commands.

## Inline SVG

Posts support inline SVG diagrams via fenced code blocks. Use the `svg`, `xml`, or `html` language tag, and the content must start with `<svg`:

````markdown
```svg
<svg viewBox="0 0 200 100" width="200" height="100">
  <rect width="200" height="100" fill="#1e293b" rx="8"/>
  <text x="100" y="55" text-anchor="middle" fill="white" font-size="16">Hello, SVG!</text>
</svg>
```
````

**Supported elements:** Basic shapes (`circle`, `rect`, `path`, `line`, `polygon`, `polyline`, `ellipse`), text (`text`, `tspan`, `textPath`), gradients (`linearGradient`, `radialGradient`, `stop`), `pattern`, `filter`, `clipPath`, `mask`, `marker`, `defs`, `g`, `use`, `symbol`, and `style` (with CSS sanitization).

**Security restrictions:** Script tags, event handlers (e.g. `onclick`), and external references are blocked. Only internal `#id` hrefs are allowed. Maximum size is 100KB.

## Visibility Levels

Both `app.greengale.document` and the legacy `app.greengale.blog.entry` support three visibility levels:

| Value | Description |
|-------|-------------|
| `public` | Visible to everyone, indexed in feeds |
| `url` | Only accessible via direct link |
| `author` | Only visible to the author (draft) |
