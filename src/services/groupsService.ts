import type {
  Contact, Group, GroupCategory, GroupInvitation, GroupMember, GroupRole, MemberInput,
} from '../lib/types';
import { callRpc, fail, ok, ServiceResult } from './result';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const badId = (what: string) => fail('INVALID_ID', `${what} is not valid.`);

// 1. createGroup (optionally with starting members)
export async function createGroup(input: {
  name: string;
  description?: string | null;
  category: GroupCategory;
  icon?: string | null;
  members?: MemberInput[];
}): Promise<ServiceResult<{ group: Group; members_added: number; member_errors: { member: string; code: string }[] }>> {
  const name = input.name.trim();
  if (name.length < 1 || name.length > 60) return fail('INVALID_NAME', 'Group name is required (up to 60 characters).');
  return callRpc('create_group', {
    p_name: name,
    p_description: input.description ?? null,
    p_category: input.category,
    p_icon: input.icon ?? null,
    p_members: input.members ?? [],
  });
}

// 2. getMyGroups: groups I own or accepted an invitation to
export async function getMyGroups(): Promise<ServiceResult<Group[]>> {
  const res = await callRpc<{ groups: Group[] }>('get_my_groups', {});
  return res.ok ? ok(res.data.groups ?? []) : res;
}

// 3. getGroupDetails
export async function getGroupDetails(
  groupId: string
): Promise<ServiceResult<{ group: Group; my_role: GroupRole; members: GroupMember[] }>> {
  if (!UUID.test(groupId)) return badId('Group');
  return callRpc('get_group_details', { p_group_id: groupId });
}

// 4. updateGroup (leave a field undefined to keep it; pass '' to clear the description)
export async function updateGroup(
  groupId: string,
  data: { name?: string; description?: string; icon?: string }
): Promise<ServiceResult<{ group: Group }>> {
  if (!UUID.test(groupId)) return badId('Group');
  if (data.name !== undefined && (data.name.trim().length < 1 || data.name.trim().length > 60))
    return fail('INVALID_NAME', 'Group name is required (up to 60 characters).');
  return callRpc('update_group', {
    p_group_id: groupId,
    p_name: data.name ?? null,
    p_description: data.description ?? null,
    p_icon: data.icon ?? null,
  });
}

// 5. deleteGroup (owner only)
export async function deleteGroup(groupId: string): Promise<ServiceResult<{ deleted_members: number }>> {
  if (!UUID.test(groupId)) return badId('Group');
  return callRpc('delete_group', { p_group_id: groupId });
}

// 6. addGroupMember: people who already have the app get an in-app invitation;
//    everyone else needs an invitation link (inviteGroupMember)
export async function addGroupMember(
  groupId: string,
  member: MemberInput
): Promise<ServiceResult<{ member: GroupMember; registered: boolean }>> {
  if (!UUID.test(groupId)) return badId('Group');
  if (!member.contact_email?.trim() && !member.contact_phone?.trim())
    return fail('CONTACT_REQUIRED', 'Add an email address or phone number.');
  return callRpc('add_group_member', { p_group_id: groupId, p_member: member });
}

// 7. removeGroupMember (also lets a person leave a group)
export async function removeGroupMember(groupId: string, memberId: string): Promise<ServiceResult<{}>> {
  if (!UUID.test(groupId) || !UUID.test(memberId)) return badId('Member');
  return callRpc('remove_group_member', { p_group_id: groupId, p_member_id: memberId });
}

// edit a member's details where permitted
export async function updateGroupMember(
  groupId: string,
  memberId: string,
  data: { name?: string; phone?: string; role?: 'admin' | 'member' }
): Promise<ServiceResult<{ member: GroupMember }>> {
  if (!UUID.test(groupId) || !UUID.test(memberId)) return badId('Member');
  return callRpc('update_group_member', {
    p_group_id: groupId,
    p_member_id: memberId,
    p_name: data.name ?? null,
    p_phone: data.phone ?? null,
    p_role: data.role ?? null,
  });
}

// 8. inviteGroupMember: creates a secure, single-use invitation (valid 7 days).
//    The token is shown once. No email/SMS service is connected, so the caller shares it.
export type InviteData = {
  token: string;
  invitation: { id: string; expires_at: string; invitee_email: string | null; invitee_phone: string | null };
  delivery: { configured: boolean; message: string };
};
export async function inviteGroupMember(
  groupId: string,
  memberId: string,
  contact?: { email?: string; phone?: string }
): Promise<ServiceResult<InviteData>> {
  if (!UUID.test(groupId) || !UUID.test(memberId)) return badId('Member');
  return callRpc('invite_group_member', {
    p_group_id: groupId,
    p_member_id: memberId,
    p_email: contact?.email ?? null,
    p_phone: contact?.phone ?? null,
  });
}

// 9. acceptGroupInvitation(token)
export async function acceptGroupInvitation(token: string): Promise<ServiceResult<{ group: Group; member_id: string }>> {
  const t = token.trim();
  if (t.length < 20) return fail('INVITATION_INVALID', 'This invitation code is not valid.');
  return callRpc('accept_group_invitation', { p_token: t });
}

// 10. getGroupMembers (owner/admin see all details; members see accepted names only)
export async function getGroupMembers(groupId: string): Promise<ServiceResult<{ my_role: GroupRole; members: GroupMember[] }>> {
  if (!UUID.test(groupId)) return badId('Group');
  return callRpc('get_group_members', { p_group_id: groupId });
}

// invitations waiting for ME inside the app
export async function getMyGroupInvitations(): Promise<ServiceResult<GroupInvitation[]>> {
  const res = await callRpc<{ invitations: GroupInvitation[] }>('get_my_group_invitations', {});
  return res.ok ? ok(res.data.invitations ?? []) : res;
}

export async function respondToGroupInvitation(memberId: string, accept: boolean): Promise<ServiceResult<{ status: string }>> {
  if (!UUID.test(memberId)) return badId('Invitation');
  return callRpc('respond_to_group_invitation', { p_member_id: memberId, p_accept: accept });
}

// people from my other groups (so one contact can be added to several groups)
export async function getMyContacts(): Promise<ServiceResult<Contact[]>> {
  const res = await callRpc<{ contacts: Contact[] }>('get_my_contacts', {});
  return res.ok ? ok(res.data.contacts ?? []) : res;
}
