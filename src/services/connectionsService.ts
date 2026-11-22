import { supabase } from '../lib/supabase';
import { callRpc, fail, ServiceResult } from './result';

// What the QR code contains: an app link with a random token. No name, email or id is ever inside.
export const QR_PREFIX = 'arrivenotify://c/';
const TOKEN = /^[0-9a-f]{64}$/;

export const buildQrPayload = (token: string) => `${QR_PREFIX}${token}`;

// Returns the token if the scanned text is an Arrive Notify invite, otherwise null
export function parseQrPayload(text: string): string | null {
  const t = (text ?? '').trim();
  if (!t.toLowerCase().startsWith(QR_PREFIX)) return null;
  const token = t.slice(QR_PREFIX.length).split(/[?#/]/)[0].toLowerCase();
  return TOKEN.test(token) ? token : null;
}

export type MyQr = { token: string; expires_at: string };
export type QrPerson = { id: string; name: string; avatar_url: string | null };
export type QrPreview = { person: QrPerson; already_connected: boolean };
export type Connection = { user_id: string; name: string; avatar_url: string | null; connected_at: string; source: string };

export async function getMyQr(): Promise<ServiceResult<MyQr>> {
  return callRpc('get_or_create_my_qr', {});
}

// Replaces my code; the old one stops working immediately
export async function regenerateMyQr(): Promise<ServiceResult<MyQr>> {
  return callRpc('regenerate_my_qr', {});
}

// Checks the code on the server and returns who it belongs to (name and picture only)
export async function previewQr(token: string): Promise<ServiceResult<QrPreview>> {
  if (!TOKEN.test(token)) return fail('QR_INVALID', 'This is not a valid Arrive Notify QR code.');
  return callRpc('preview_qr', { p_token: token });
}

export async function acceptQrConnection(token: string): Promise<ServiceResult<QrPreview>> {
  if (!TOKEN.test(token)) return fail('QR_INVALID', 'This is not a valid Arrive Notify QR code.');
  return callRpc('accept_qr_connection', { p_token: token });
}

export async function getMyConnections(): Promise<ServiceResult<{ connections: Connection[] }>> {
  return callRpc('get_my_connections', {});
}

// Disconnects both people, and removes the person from my own People list too
export async function removeConnection(userId: string): Promise<ServiceResult<{ removed: boolean }>> {
  const res = await callRpc<{ removed: boolean }>('remove_connection', { p_user_id: userId });
  if (res.ok) await supabase.from('contacts').delete().eq('contact_user_id', userId);
  return res;
}

// Keeps the existing People list (contacts table) in step with QR connections. Each phone adds the
// missing rows to its OWN list using the same insert the email flow uses. Never removes anything.
export async function syncConnectionsToContacts(): Promise<void> {
  try {
    const conns = await getMyConnections();
    if (!conns.ok) return;
    const { data: rows, error } = await supabase.from('contacts').select('contact_user_id');
    if (error) return;
    const have = new Set((rows ?? []).map((r) => r.contact_user_id as string));
    for (const c of conns.data.connections) {
      if (!have.has(c.user_id)) await supabase.from('contacts').insert({ contact_user_id: c.user_id }); // duplicate (23505) is harmless
    }
  } catch {
    // People list stays as it was; retried next time
  }
}
