# Husnalogy Customizer V2 Architecture

## System boundary

Customizer V2 is one product system with four surfaces:

1. The administrator Design Studio authors a mutable product draft.
2. Publishing creates an immutable, versioned Customizer document.
3. The customer editor stores field values and editor-state overrides against
   that trusted version without modifying the template.
4. The server resolves the document into SVG, PNG, PDF, mockup, cart preview,
   and immutable order-snapshot outputs.

The browser preview is interactive feedback. Server SVG is the production
render source; screenshot-based browser rendering is not a production path.

## Authoritative folders

| Area | Location | Responsibility |
| --- | --- | --- |
| Customer route | `app/products/[slug]/personalize/` | Responsive workflow, state, autosave, restore, cart handoff |
| Shared UI | `app/components/customizer/` | Canvas, toolbars, layers, previews, page navigation |
| Admin studio | `app/admin/dashboard/design-builder/` | Draft authoring, permissions, fields, options, versions, mockups |
| API | `app/api/customizer/`, `app/api/customizations/`, admin customizer routes | Authentication, ownership, validation, uploads, rendering |
| Compatibility model | `lib/customizer/index.ts` | Existing flat product-template rows |
| Typed V2 engine | `lib/customizer/v2/` | Documents, migration, geometry, fonts, masks, grids, groups, QR, filters, preflight, rendering |
| Persistence orchestration | `lib/customizer/*.ts` | Versions, mockups, render jobs, order snapshots, private assets |
| Database | `supabase/customizer_v2.sql`, `supabase/migrations/` | Canonical install surface and additive upgrades |
| Database types | `lib/supabase/database.types.ts` | Generated Customizer table contract |
| Tests | `lib/customizer/v2/__tests__/`, `e2e/` | Engine, permissions, rendering, UI and security journeys |

The per-file runtime/import inventory is generated in
`CUSTOMIZER_DEPENDENCY_MAP.md` by `npm run audit:customizer`.

## Data flow

```text
Admin draft -> publish validation -> immutable template version
      |                                  |
      v                                  v
customer editor -> validated save -> customization + stable asset references
                                           |
                                           v
trusted resolver -> preflight -> SVG -> PNG/PDF -> mockup
                                           |
                                           v
                           cart reference -> immutable order snapshot
```

`product_customizer_templates` is the mutable compatibility draft.
`customizer_template_versions` is the immutable publication history.
`customizer_mockup_templates.status/version` describes mockup publications;
it is not a third template-version system. These names are retained to avoid a
destructive data rename.

## Shared engine rules

- `types.ts` and `document.ts` own the V2 document and migration boundary.
- `fonts.ts`, `text-layout.ts`, `masks.ts`, `grids.ts`, `groups.ts`,
  `image-filters.ts`, and `qr.ts` are the single implementations for their
  concerns.
- Server save validation reloads the trusted version and rejects forged
  permissions, feature flags, prices, asset ownership, or geometry.
- Private database JSON stores stable bucket/path references, never expiring
  signed URLs or large base64 images.
- Existing V1 and V2 adapters remain until a database audit proves no stored
  record needs them.
- Order snapshots and published versions are immutable compatibility records.

## Rendering and storage

The render pipeline builds deterministic SVG, rasterizes with Resvg, creates
physical-size PDFs with pdf-lib, and maps flat artwork into normalized mockup
scenes. The flat product preview remains the fallback if mockup rendering fails.

| Bucket | Access model | Content |
| --- | --- | --- |
| `customer-uploads` | Private, owner-prefix writes and signed reads | Original/editor/thumbnail customer assets |
| `customizer-elements` | Private, admin writes and signed reads | Permanent original/editor/thumbnail administrator assets |
| `product-mockups` | Public read, admin writes | Approved mockup base images/overlays |
| `customizer-renders` | Private, service-role writes and signed reads | PNG, PDF, WebP and render derivatives |

## UI contract

The customizer uses Husnalogy charcoal `#303839`, warm paper `#F8F6F1`, gold
`#D4AF37`, Cormorant Garamond headings, and licensed local body fonts where
available. It avoids glow effects. Customer controls are touch-friendly;
advanced admin properties use progressive disclosure; reduced-motion settings
disable nonessential transitions.

## Security and rollout

RLS is enabled on every Customizer table. Administrative writes require
`is_admin()` or service role; customer reads/writes are ownership-scoped.
Storage writes are prefix/bucket restricted. Feature flags remain both rollout
and rollback controls, and disabled feature code remains readable for saved
documents.

See `CUSTOMIZER_DATABASE.md`, `CUSTOMIZER_DEPLOYMENT.md`,
`CUSTOMIZER_ADMIN_GUIDE.md`, and `CUSTOMIZER_ROLLBACK.md` for operations.
