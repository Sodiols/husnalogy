"use client";

// Overview of every customer-editable field across both pages. Read-only summary
// that lets admin jump to the connected layer. The actual editing happens on the
// selected layer in the right panel.

export default function AdminEditableFieldsPanel({ template, onSelectLayer, onClose }: any) {
  const layers = template?.layers || [];
  const fields = (template?.fields || []).map((field: any) => {
    const layer = layers.find((l: any) => l.fieldId === field.id && l.customerEditable);
    return { field, layer };
  }).filter((entry: any) => entry.layer);

  return (
    <div className="fixed inset-0 z-[120] flex justify-end bg-[#111111]/30" onClick={onClose}>
      <div className="h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-body text-2xl text-[#111111]">Customer editable fields</h3>
          <button type="button" onClick={onClose} className="text-xl text-[#111111]/60 hover:text-[#111111]">✕</button>
        </div>

        <p className="mb-4 text-xs text-[#111111]/55">These are the only things a customer can change. Everything else in the design is locked.</p>

        <div className="grid gap-2">
          {fields.map(({ field, layer }: any) => (
            <button
              key={field.id}
              type="button"
              onClick={() => { onSelectLayer(layer.id); onClose(); }}
              className="flex items-center justify-between gap-2 border border-[#111111]/12 bg-white px-3 py-2.5 text-left hover:bg-[#F8F8F8]"
            >
              <span className="min-w-0">
                <span className="block truncate text-sm font-bold text-[#111111]">{field.label}</span>
                <span className="block truncate text-[11px] text-[#111111]/50">
                  {field.id} · {field.type}{field.required ? " · required" : ""} · {layer.page}
                </span>
              </span>
              <span className="shrink-0 text-[11px] font-bold text-[#111111]/45">Edit →</span>
            </button>
          ))}
          {!fields.length && <p className="text-sm text-[#111111]/50">No editable fields yet. Select a layer and turn on “Make customer editable”.</p>}
        </div>
      </div>
    </div>
  );
}
