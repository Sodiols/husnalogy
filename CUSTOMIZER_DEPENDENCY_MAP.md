# Customizer Dependency Map

Generated: 2026-08-06T16:13:03.423Z

This inventory covers static imports, dynamic `import()`/`require()` calls, Next.js route entry points, package scripts, tests, migrations, Supabase functions, worker/configuration strings, and route URL references. A zero-import file is not automatically unused: framework and deployment entry points are retained explicitly.

Files audited: 183

| File | Category | Static importers | Dynamic importers | Runtime/string references | Audit decision |
| --- | --- | ---: | ---: | ---: | --- |
| `app/admin/dashboard/design-builder/AdminBuilderHeader.tsx` | admin UI | 1 | 0 | 2 | KEEP: referenced |
| `app/admin/dashboard/design-builder/AdminCanvas.tsx` | admin UI | 1 | 0 | 8 | KEEP: referenced |
| `app/admin/dashboard/design-builder/AdminContextToolbar.tsx` | admin UI | 1 | 0 | 4 | KEEP: referenced |
| `app/admin/dashboard/design-builder/AdminCustomerPreview.tsx` | admin UI | 1 | 0 | 3 | KEEP: referenced |
| `app/admin/dashboard/design-builder/AdminDesignBuilder.tsx` | admin UI | 1 | 0 | 8 | KEEP: referenced |
| `app/admin/dashboard/design-builder/AdminFieldsPanel.tsx` | admin UI | 1 | 0 | 1 | KEEP: referenced |
| `app/admin/dashboard/design-builder/AdminLayersPanel.tsx` | admin UI | 1 | 0 | 2 | KEEP: referenced |
| `app/admin/dashboard/design-builder/AdminMockupEditor.tsx` | admin UI | 1 | 0 | 1 | KEEP: referenced |
| `app/admin/dashboard/design-builder/AdminPagesPanel.tsx` | admin UI | 1 | 0 | 2 | KEEP: referenced |
| `app/admin/dashboard/design-builder/AdminProductOptionsPanel.tsx` | admin UI | 1 | 0 | 1 | KEEP: referenced |
| `app/admin/dashboard/design-builder/AdminPropertiesPanel.tsx` | admin UI | 1 | 0 | 5 | KEEP: referenced |
| `app/admin/dashboard/design-builder/AdminTemplateSettings.tsx` | admin UI | 1 | 0 | 1 | KEEP: referenced |
| `app/admin/dashboard/design-builder/AdminTextToolPanel.tsx` | admin UI | 1 | 0 | 1 | KEEP: referenced |
| `app/admin/dashboard/design-builder/AdminToolRail.tsx` | admin UI | 1 | 0 | 5 | KEEP: referenced |
| `app/admin/dashboard/design-builder/AdminUploadsPanel.tsx` | admin UI | 1 | 0 | 3 | KEEP: referenced |
| `app/admin/dashboard/design-builder/builder-utils.ts` | admin UI | 17 | 0 | 8 | KEEP: referenced |
| `app/api/admin/customizer/asset-categories/route.ts` | Next API route | 0 | 0 | 2 | KEEP: framework/script/test/migration entry point |
| `app/api/admin/customizer/asset-folders/[id]/route.ts` | Next API route | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `app/api/admin/customizer/asset-folders/route.ts` | Next API route | 0 | 0 | 2 | KEEP: framework/script/test/migration entry point |
| `app/api/admin/customizer/assets/[id]/route.ts` | Next API route | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `app/api/admin/customizer/assets/route.ts` | Next API route | 0 | 0 | 9 | KEEP: framework/script/test/migration entry point |
| `app/api/admin/customizer/feature-flags/[productId]/route.ts` | Next API route | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `app/api/admin/customizer/mockups/[productId]/import/route.ts` | Next API route | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `app/api/admin/customizer/mockups/[productId]/publish/route.ts` | Next API route | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `app/api/admin/customizer/mockups/[productId]/route.ts` | Next API route | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `app/api/admin/customizer/orders/[orderId]/snapshots/route.ts` | Next API route | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `app/api/admin/customizer/render/process/route.ts` | Next API route | 0 | 0 | 2 | KEEP: framework/script/test/migration entry point |
| `app/api/admin/customizer/render/retry/route.ts` | Next API route | 0 | 0 | 3 | KEEP: framework/script/test/migration entry point |
| `app/api/admin/customizer/templates/[productId]/publish/route.ts` | Next API route | 0 | 0 | 2 | KEEP: framework/script/test/migration entry point |
| `app/api/admin/customizer/templates/[productId]/versions/route.ts` | Next API route | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `app/api/customizations/[id]/route.ts` | Next API route | 0 | 0 | 3 | KEEP: framework/script/test/migration entry point |
| `app/api/customizations/route.ts` | Next API route | 0 | 0 | 8 | KEEP: framework/script/test/migration entry point |
| `app/api/customizer/assets/[id]/route.ts` | Next API route | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `app/api/customizer/assets/resolve/route.ts` | Next API route | 0 | 0 | 2 | KEEP: framework/script/test/migration entry point |
| `app/api/customizer/elements/route.ts` | Next API route | 0 | 0 | 2 | KEEP: framework/script/test/migration entry point |
| `app/api/customizer/library/[id]/route.ts` | Next API route | 0 | 0 | 3 | KEEP: framework/script/test/migration entry point |
| `app/api/customizer/library/route.ts` | Next API route | 0 | 0 | 5 | KEEP: framework/script/test/migration entry point |
| `app/api/customizer/preflight/route.ts` | Next API route | 0 | 0 | 3 | KEEP: framework/script/test/migration entry point |
| `app/api/customizer/render/[jobId]/route.ts` | Next API route | 0 | 0 | 2 | KEEP: framework/script/test/migration entry point |
| `app/api/customizer/render/route.ts` | Next API route | 0 | 0 | 6 | KEEP: framework/script/test/migration entry point |
| `app/api/customizer/upload/route.ts` | Next API route | 0 | 0 | 4 | KEEP: framework/script/test/migration entry point |
| `app/components/customizer/CustomerAddTextPanel.tsx` | customer/shared UI | 2 | 0 | 4 | KEEP: referenced |
| `app/components/customizer/CustomerContextToolbar.tsx` | customer/shared UI | 2 | 0 | 5 | KEEP: referenced |
| `app/components/customizer/CustomerCustomizerHeader.tsx` | customer/shared UI | 1 | 0 | 3 | KEEP: referenced |
| `app/components/customizer/CustomerEditPanel.tsx` | customer/shared UI | 4 | 0 | 6 | KEEP: referenced |
| `app/components/customizer/CustomerElementsPanel.tsx` | customer/shared UI | 2 | 0 | 3 | KEEP: referenced |
| `app/components/customizer/CustomerElementToolbar.tsx` | customer/shared UI | 1 | 0 | 2 | KEEP: referenced |
| `app/components/customizer/CustomerGridToolbar.tsx` | customer/shared UI | 1 | 0 | 3 | KEEP: referenced |
| `app/components/customizer/CustomerImageToolbar.tsx` | customer/shared UI | 1 | 0 | 2 | KEEP: referenced |
| `app/components/customizer/CustomerInsertPanel.tsx` | customer/shared UI | 1 | 0 | 3 | KEEP: referenced |
| `app/components/customizer/CustomerLayersPanel.tsx` | customer/shared UI | 1 | 0 | 3 | KEEP: referenced |
| `app/components/customizer/CustomerMockupPreview.tsx` | customer/shared UI | 2 | 0 | 2 | KEEP: referenced |
| `app/components/customizer/CustomerOptionsPanel.tsx` | customer/shared UI | 2 | 0 | 3 | KEEP: referenced |
| `app/components/customizer/CustomerProductEditingPreview.tsx` | customer/shared UI | 1 | 0 | 3 | KEEP: referenced |
| `app/components/customizer/CustomerSelectionPanel.tsx` | customer/shared UI | 1 | 0 | 3 | KEEP: referenced |
| `app/components/customizer/CustomerShortcutHelp.tsx` | customer/shared UI | 1 | 0 | 3 | KEEP: referenced |
| `app/components/customizer/CustomerToolRail.tsx` | customer/shared UI | 2 | 0 | 3 | KEEP: referenced |
| `app/components/customizer/CustomerUploadsPanel.tsx` | customer/shared UI | 2 | 0 | 4 | KEEP: referenced |
| `app/components/customizer/customizer-utils.ts` | customer/shared UI | 17 | 0 | 11 | KEEP: referenced |
| `app/components/customizer/CustomizerPageThumbnails.tsx` | customer/shared UI | 2 | 0 | 3 | KEEP: referenced |
| `app/components/customizer/CustomizerPreview.tsx` | customer/shared UI | 9 | 0 | 7 | KEEP: referenced |
| `app/components/customizer/CustomizerProtectionOverlay.tsx` | customer/shared UI | 2 | 0 | 2 | KEEP: referenced |
| `app/components/customizer/CustomizerReviewStep.tsx` | customer/shared UI | 2 | 0 | 3 | KEEP: referenced |
| `app/components/customizer/CustomizerWorkspace.tsx` | customer/shared UI | 3 | 0 | 8 | KEEP: referenced |
| `app/components/customizer/CustomizerZoomControls.tsx` | customer/shared UI | 3 | 0 | 5 | KEEP: referenced |
| `app/components/customizer/EditableNumericStepper.tsx` | customer/shared UI | 14 | 0 | 9 | KEEP: referenced |
| `app/components/customizer/InlineCanvasTextEditor.tsx` | customer/shared UI | 2 | 0 | 4 | KEEP: referenced |
| `app/components/customizer/ServerCustomizationImage.tsx` | customer/shared UI | 4 | 0 | 6 | KEEP: referenced |
| `app/components/customizer/TextAlignmentDropdown.tsx` | customer/shared UI | 2 | 0 | 3 | KEEP: referenced |
| `app/components/customizer/ToolbarDropdown.tsx` | customer/shared UI | 3 | 0 | 3 | KEEP: referenced |
| `app/components/customizer/useCustomizerHistory.ts` | customer/shared UI | 1 | 0 | 2 | KEEP: referenced |
| `app/components/customizer/useCustomizerProtection.ts` | customer/shared UI | 1 | 0 | 2 | KEEP: referenced |
| `app/products/[slug]/personalize/page.tsx` | Next route entry | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `app/products/[slug]/personalize/personalize-client.tsx` | support | 1 | 0 | 9 | KEEP: referenced |
| `CUSTOMIZER_DATABASE.md` | documentation | 0 | 0 | 4 | KEEP: referenced |
| `CUSTOMIZER_DEPENDENCY_MAP.md` | documentation | 0 | 0 | 1 | KEEP: referenced |
| `docs/CUSTOMIZER_ADMIN_GUIDE.md` | documentation | 0 | 0 | 1 | KEEP: referenced |
| `docs/CUSTOMIZER_V2_FINAL_VALIDATION_REPORT.md` | documentation | 0 | 0 | 1 | KEEP: referenced |
| `docs/CUSTOMIZER_V2.md` | documentation | 0 | 0 | 1 | KEEP: referenced |
| `e2e/customer-customizer.spec.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `e2e/customizer-responsive.spec.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `e2e/customizer-text-editing.spec.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/__tests__/save-queue.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/assets.ts` | engine/service | 7 | 0 | 7 | KEEP: referenced |
| `lib/customizer/audit.ts` | engine/service | 2 | 0 | 4 | KEEP: referenced |
| `lib/customizer/customizations.ts` | engine/service | 6 | 0 | 7 | KEEP: referenced |
| `lib/customizer/index.ts` | engine/service | 17 | 1 | 5 | KEEP: referenced |
| `lib/customizer/mockup-store.ts` | engine/service | 5 | 0 | 6 | KEEP: referenced |
| `lib/customizer/numeric-stepper.ts` | engine/service | 2 | 0 | 3 | KEEP: referenced |
| `lib/customizer/order-snapshots.ts` | engine/service | 3 | 0 | 6 | KEEP: referenced |
| `lib/customizer/public-version.ts` | engine/service | 4 | 0 | 5 | KEEP: referenced |
| `lib/customizer/render-jobs.ts` | engine/service | 5 | 1 | 7 | KEEP: referenced |
| `lib/customizer/save-queue.ts` | engine/service | 2 | 0 | 2 | KEEP: referenced |
| `lib/customizer/save-validation.ts` | engine/service | 3 | 0 | 4 | KEEP: referenced |
| `lib/customizer/server/admin-assets.ts` | engine/service | 11 | 0 | 8 | KEEP: referenced |
| `lib/customizer/server/asset-variants.ts` | engine/service | 2 | 0 | 3 | KEEP: referenced |
| `lib/customizer/server/private-assets.ts` | engine/service | 9 | 0 | 9 | KEEP: referenced |
| `lib/customizer/store.ts` | engine/service | 3 | 0 | 6 | KEEP: referenced |
| `lib/customizer/v2/__tests__/admin-editor-layout.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/admin-multi-selection.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/admin-properties-sidebar.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/admin-upload-rendering.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/admin-upload-validation.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/admin-upload-variants.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/admin-uploads-panel.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/asset-references.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/customer-actions.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/customer-dropdown-design.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/customer-editable.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/customer-editor-shell.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/customer-fields.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/customer-group-template-layers.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/customer-toolbar-layout.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/customization-version-restore.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/database-contract.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/document.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/easy-personalize-field-order.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/easy-personalize-mode.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/feature-flags-server.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/final-verification-scenarios.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/fonts-registry.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/grids.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/groups.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/linked-fields.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/masks.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/mockups-render-jobs.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/numeric-stepper-component.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/numeric-stepper.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/parity.test.ts` | test | 0 | 0 | 2 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/photo-replace-crop-reset.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/pricing-preflight.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/public-version.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/save-validation-stale-overrides.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/selection-geometry.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/server-customization-image.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/server-render.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/single-line-text-resize.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/text-auto-width-render.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/text-auto-width.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/text-editing.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/text-editor-keys.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/text-layout.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/validate.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/viewport-pan.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/__tests__/zoom.test.ts` | test | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `lib/customizer/v2/asset-references.ts` | engine/service | 8 | 0 | 6 | KEEP: referenced |
| `lib/customizer/v2/customer-actions.ts` | engine/service | 3 | 0 | 3 | KEEP: referenced |
| `lib/customizer/v2/customer-fields.ts` | engine/service | 2 | 0 | 2 | KEEP: referenced |
| `lib/customizer/v2/document.ts` | engine/service | 9 | 0 | 7 | KEEP: referenced |
| `lib/customizer/v2/feature-flags.server.ts` | engine/service | 6 | 0 | 6 | KEEP: referenced |
| `lib/customizer/v2/feature-flags.ts` | engine/service | 10 | 0 | 9 | KEEP: referenced |
| `lib/customizer/v2/fonts.ts` | engine/service | 8 | 0 | 6 | KEEP: referenced |
| `lib/customizer/v2/grids.ts` | engine/service | 13 | 0 | 11 | KEEP: referenced |
| `lib/customizer/v2/groups.ts` | engine/service | 10 | 0 | 7 | KEEP: referenced |
| `lib/customizer/v2/image-filters.ts` | engine/service | 8 | 0 | 5 | KEEP: referenced |
| `lib/customizer/v2/masks.ts` | engine/service | 4 | 0 | 3 | KEEP: referenced |
| `lib/customizer/v2/mockups.ts` | engine/service | 6 | 0 | 4 | KEEP: referenced |
| `lib/customizer/v2/preflight.ts` | engine/service | 6 | 0 | 5 | KEEP: referenced |
| `lib/customizer/v2/preview-mapping.ts` | engine/service | 1 | 0 | 2 | KEEP: referenced |
| `lib/customizer/v2/pricing.ts` | engine/service | 3 | 0 | 4 | KEEP: referenced |
| `lib/customizer/v2/qr.ts` | engine/service | 9 | 0 | 6 | KEEP: referenced |
| `lib/customizer/v2/selection-geometry.ts` | engine/service | 8 | 0 | 6 | KEEP: referenced |
| `lib/customizer/v2/server/mockup-render.ts` | engine/service | 2 | 0 | 2 | KEEP: referenced |
| `lib/customizer/v2/server/render.ts` | engine/service | 9 | 0 | 9 | KEEP: referenced |
| `lib/customizer/v2/server/server-fonts.ts` | engine/service | 5 | 0 | 3 | KEEP: referenced |
| `lib/customizer/v2/svg.ts` | engine/service | 8 | 0 | 4 | KEEP: referenced |
| `lib/customizer/v2/text-editing.ts` | engine/service | 17 | 0 | 13 | KEEP: referenced |
| `lib/customizer/v2/text-layout.ts` | engine/service | 18 | 0 | 10 | KEEP: referenced |
| `lib/customizer/v2/types.ts` | engine/service | 10 | 0 | 6 | KEEP: referenced |
| `lib/customizer/v2/uploads.ts` | engine/service | 3 | 0 | 4 | KEEP: referenced |
| `lib/customizer/v2/validate.ts` | engine/service | 8 | 0 | 4 | KEEP: referenced |
| `lib/customizer/v2/viewport-pan.ts` | engine/service | 3 | 0 | 4 | KEEP: referenced |
| `lib/customizer/v2/zoom.ts` | engine/service | 5 | 0 | 6 | KEEP: referenced |
| `lib/customizer/versions.ts` | engine/service | 7 | 0 | 10 | KEEP: referenced |
| `scripts/seed-customizer-test.mjs` | script | 0 | 0 | 3 | KEEP: framework/script/test/migration entry point |
| `scripts/validate-customizer-database.mjs` | script | 0 | 0 | 2 | KEEP: framework/script/test/migration entry point |
| `scripts/validate-customizer-fonts.mjs` | script | 0 | 0 | 2 | KEEP: framework/script/test/migration entry point |
| `supabase/customizer_v2.sql` | database SQL | 0 | 0 | 5 | KEEP: referenced |
| `supabase/migrations/20260714120000_customizer_v2.sql` | database migration | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `supabase/migrations/20260714153000_customizer_v2_completion.sql` | database migration | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `supabase/migrations/20260714210000_customizer_v2_production_hardening.sql` | database migration | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |
| `supabase/migrations/20260718120000_customizer_v2_customer_parity.sql` | database migration | 0 | 0 | 2 | KEEP: framework/script/test/migration entry point |
| `supabase/migrations/20260719120000_customizer_v2_schema_consolidation.sql` | database migration | 0 | 0 | 1 | KEEP: framework/script/test/migration entry point |

## Files requiring manual review

No non-entry customizer file lacks an inbound reference.

## Circular dependency check

No static or dynamic import cycle was found inside the Customizer file graph.

## Deletion rule

A REVIEW result is only a lead. Before removal, inspect exports, framework conventions, dynamic routes, package/configuration references, tests, worker entry points, Supabase SQL/functions, stored document compatibility, and the replacement path. Record the final evidence in `CUSTOMIZER_CLEANUP_REPORT.md`.

