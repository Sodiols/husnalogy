export function canMirrorUserOrders() {
  return false;
}

export async function mirrorUserOrder(_order: any = {}) {
  return { ok: false, skipped: true };
}

export async function deleteUserOrderMirror(_order: any = {}) {
  return { ok: false, skipped: true };
}
