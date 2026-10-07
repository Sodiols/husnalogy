/**
 * Saved delivery addresses, stored per account in `customer_addresses`.
 *
 * Every function takes the SESSION-scoped Supabase client of the signed-in
 * customer: Row Level Security (user_id = auth.uid()) is the enforcement, and
 * the explicit `user_id` filters below are a second layer, not the only one.
 * The service role is never used here.
 */
import { z } from "zod";

export const MAX_SAVED_ADDRESSES = 10;

const text = (max: number) => z.string().trim().max(max);
const required = (max: number, message: string) => z.string().trim().min(1, message).max(max);

/** What a customer may send. Unknown keys are dropped; ownership is never accepted from the client. */
export const addressInputSchema = z.object({
  fullName: required(120, "Full name is required."),
  phone: z.string().trim().min(5, "Enter a valid phone number.").max(30, "Enter a valid phone number.").regex(/^[0-9+()\-.\s]+$/, "Enter a valid phone number."),
  addressLine1: required(300, "Full address is required."),
  area: text(120).optional().default(""),
  city: required(80, "City is required."),
  district: text(80).optional().default(""),
  postalCode: text(20).optional().default(""),
  note: text(300).optional().default(""),
  isDefault: z.boolean().optional(),
});
export const addressPatchSchema = addressInputSchema.partial();

export type AddressInput = z.infer<typeof addressInputSchema>;

export type SavedAddress = {
  id: string;
  fullName: string;
  phone: string;
  addressLine1: string;
  area: string;
  city: string;
  district: string;
  postalCode: string;
  note: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export function addressFromRow(row: any): SavedAddress {
  return {
    id: String(row.id),
    fullName: String(row.full_name || ""),
    phone: String(row.phone || ""),
    addressLine1: String(row.address_line1 || ""),
    area: String(row.area || ""),
    city: String(row.city || ""),
    district: String(row.district || ""),
    postalCode: String(row.postal_code || ""),
    note: String(row.note || ""),
    isDefault: Boolean(row.is_default),
    createdAt: String(row.created_at || ""),
    updatedAt: String(row.updated_at || ""),
  };
}

function rowFromInput(input: Partial<AddressInput>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (input.fullName !== undefined) row.full_name = input.fullName;
  if (input.phone !== undefined) row.phone = input.phone;
  if (input.addressLine1 !== undefined) row.address_line1 = input.addressLine1;
  if (input.area !== undefined) row.area = input.area;
  if (input.city !== undefined) row.city = input.city;
  if (input.district !== undefined) row.district = input.district;
  if (input.postalCode !== undefined) row.postal_code = input.postalCode;
  if (input.note !== undefined) row.note = input.note;
  return row;
}

export class AddressError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "AddressError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listAddresses(supabase: any, userId: string): Promise<SavedAddress[]> {
  const { data, error } = await supabase
    .from("customer_addresses")
    .select("*")
    .eq("user_id", userId)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });
  if (error) throw new AddressError("Your addresses could not be loaded.", 500);
  return (data || []).map(addressFromRow);
}

/** Make `addressId` the only default address of this account. */
async function makeDefault(supabase: any, userId: string, addressId: string) {
  const { error: clearError } = await supabase.from("customer_addresses").update({ is_default: false }).eq("user_id", userId).neq("id", addressId).eq("is_default", true);
  if (clearError) throw new AddressError("The default address could not be changed.", 500);
  const { error } = await supabase.from("customer_addresses").update({ is_default: true }).eq("user_id", userId).eq("id", addressId);
  if (error) throw new AddressError("The default address could not be changed.", 500);
}

export async function createAddress(supabase: any, userId: string, input: AddressInput): Promise<SavedAddress> {
  const existing = await listAddresses(supabase, userId);
  if (existing.length >= MAX_SAVED_ADDRESSES) throw new AddressError(`You can keep up to ${MAX_SAVED_ADDRESSES} saved addresses. Remove one first.`, 409);
  const { data, error } = await supabase
    .from("customer_addresses")
    .insert({ ...rowFromInput(input), user_id: userId, is_default: false })
    .select("*")
    .maybeSingle();
  if (error || !data) throw new AddressError("The address could not be saved.", 500);
  // The first address, or one the customer marked, is the default.
  if (input.isDefault || !existing.length) await makeDefault(supabase, userId, String(data.id));
  return addressFromRow({ ...data, is_default: Boolean(input.isDefault || !existing.length) });
}

export async function updateAddress(supabase: any, userId: string, addressId: string, patch: Partial<AddressInput>): Promise<SavedAddress> {
  if (!UUID.test(addressId)) throw new AddressError("Address not found.", 404);
  const row = rowFromInput(patch);
  if (Object.keys(row).length) {
    const { data, error } = await supabase.from("customer_addresses").update(row).eq("user_id", userId).eq("id", addressId).select("id").maybeSingle();
    if (error) throw new AddressError("The address could not be saved.", 500);
    if (!data) throw new AddressError("Address not found.", 404);
  }
  if (patch.isDefault === true) await makeDefault(supabase, userId, addressId);
  const { data: fresh, error: readError } = await supabase.from("customer_addresses").select("*").eq("user_id", userId).eq("id", addressId).maybeSingle();
  if (readError) throw new AddressError("The address could not be loaded.", 500);
  if (!fresh) throw new AddressError("Address not found.", 404);
  return addressFromRow(fresh);
}

export async function deleteAddress(supabase: any, userId: string, addressId: string): Promise<void> {
  if (!UUID.test(addressId)) throw new AddressError("Address not found.", 404);
  const { data, error } = await supabase.from("customer_addresses").delete().eq("user_id", userId).eq("id", addressId).select("id,is_default").maybeSingle();
  if (error) throw new AddressError("The address could not be removed.", 500);
  if (!data) throw new AddressError("Address not found.", 404);
  if (data.is_default) {
    // Keep a default when addresses remain.
    const remaining = await listAddresses(supabase, userId);
    if (remaining[0]) await makeDefault(supabase, userId, remaining[0].id);
  }
}

/** The first validation message, for a 400 response. */
export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message || "The address is invalid.";
}
