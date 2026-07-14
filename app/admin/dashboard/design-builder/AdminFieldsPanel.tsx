"use client";

// Fields manager tab (Section 30). In this system a customer field always
// belongs to a customer-editable layer (that connection is the single source
// of truth, reconciled on save). This tab shows every field with its
// connection, lets the admin edit all field properties in one place, and
// surfaces warnings for anything that will not survive a save.

export default function AdminFieldsPanel({
  template,
  onFieldPatch,
  onSelectLayer,
  onToggleRequired,
}: any) {
  const layers = template?.layers || [];
  const fields = template?.fields || [];

  const connected = fields.map((field: any) => {
    const layer = layers.find((l: any) => l.fieldId === field.id && l.customerEditable);
    return { field, layer };
  });
  const orphanFields = connected.filter((entry: any) => !entry.layer);
  const editableWithoutField = layers.filter(
    (layer: any) => layer.customerEditable && (!layer.fieldId || !fields.some((f: any) => f.id === layer.fieldId)),
  );

  const input = "h-10 w-full rounded-lg border border-[#303839]/15 bg-white px-3 text-sm text-[#303839] shadow-sm outline-none transition focus:border-[#D4AF37] focus:ring-2 focus:ring-[#D4AF37]/20";

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-5 p-4 md:p-6 2xl:p-8">
      <div>
        <h3 className="font-display text-2xl text-[#303839]">Customer fields</h3>
        <p className="mt-1 text-sm text-[#303839]/55">
          These are the only things a customer can change. A field is created by marking a layer
          “customer editable” on the Design tab; everything else in the design stays locked.
        </p>
      </div>

      {editableWithoutField.length > 0 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
          <p className="font-bold">These editable layers have no field yet (fixed automatically on save):</p>
          {editableWithoutField.map((layer: any) => (
            <button key={layer.id} type="button" onClick={() => onSelectLayer(layer.id)} className="mt-1 block underline underline-offset-2">
              {layer.name} · {layer.page}
            </button>
          ))}
        </div>
      )}

      {orphanFields.length > 0 && (
        <div className="rounded-lg border border-[#D4AF37]/50 bg-[#D4AF37]/10 p-3 text-sm text-[#8a701d]">
          <p className="font-bold">Not connected to any editable layer (removed on save):</p>
          <p className="mt-0.5">{orphanFields.map((entry: any) => entry.field.label || entry.field.id).join(", ")}</p>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        {connected
          .filter((entry: any) => entry.layer)
          .map(({ field, layer }: any) => (
            <div key={field.id} className="rounded-lg border border-[#303839]/12 bg-white p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-[#F8F6F1] px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-[#303839]/70">
                    {field.type}
                  </span>
                  <span className="text-[11px] font-bold text-[#303839]/45">
                    {field.id} · page: {layer.page}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onSelectLayer(layer.id)}
                  className="rounded-full border border-[#303839]/15 px-3 py-1 text-xs font-bold text-[#303839] hover:bg-[#F8F6F1]"
                >
                  Open layer →
                </button>
              </div>

              <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[#303839]/55">Customer label</span>
                  <input className={input} value={field.label || ""} onChange={(e) => onFieldPatch(layer.id, { label: e.target.value })} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[#303839]/55">Placeholder</span>
                  <input className={input} value={field.placeholder || ""} onChange={(e) => onFieldPatch(layer.id, { placeholder: e.target.value })} />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[#303839]/55">Helper text</span>
                  <input className={input} value={field.helpText || ""} onChange={(e) => onFieldPatch(layer.id, { helpText: e.target.value })} />
                </label>
                {field.type !== "image" && field.type !== "file" ? (
                  <label className="block">
                    <span className="mb-1 block text-[10px] font-bold uppercase tracking-wide text-[#303839]/55">Max length (0 = none)</span>
                    <input
                      type="number"
                      min={0}
                      className={input}
                      value={field.maxLength || 0}
                      onChange={(e) => onFieldPatch(layer.id, { maxLength: Number(e.target.value) || 0 })}
                    />
                  </label>
                ) : (
                  <span />
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-xs font-bold text-[#303839]/75">
                  <input
                    type="checkbox"
                    checked={Boolean(field.required)}
                    onChange={(e) => onToggleRequired(layer.id, e.target.checked)}
                    className="h-4 w-4 accent-[#303839]"
                  />
                  Required
                </label>
                <label className="flex items-center gap-2 text-xs font-bold text-[#303839]/75">
                  <input
                    type="checkbox"
                    checked={field.customerVisible !== false}
                    onChange={(e) => onFieldPatch(layer.id, { customerVisible: e.target.checked })}
                    className="h-4 w-4 accent-[#303839]"
                  />
                  Visible to customers
                </label>
              </div>
            </div>
          ))}
      </div>

      {!connected.filter((entry: any) => entry.layer).length && (
        <p className="rounded-lg border border-[#303839]/12 bg-white p-6 text-center text-sm text-[#303839]/55">
          No customer fields yet. On the Design tab, select a text or image layer and turn on
          “customer editable”.
        </p>
      )}
    </div>
  );
}
