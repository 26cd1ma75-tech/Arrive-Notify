export type Place = {
  id: string;
  name: string;
  category: string | null;
  address: string | null;
  latitude: number;
  longitude: number;
  arrival_radius: number;
  is_favorite: boolean;
  created_at?: string;
  updated_at?: string;
};

export type JourneyStatus = 'active' | 'arrived' | 'cancelled';

export type Journey = {
  id: string;
  place_id: string | null;
  destination_name: string;
  destination_address: string | null;
  status: JourneyStatus;
  start_latitude: number | null;
  start_longitude: number | null;
  destination_latitude: number;
  destination_longitude: number;
  arrival_radius: number;
  started_at: string;
  estimated_arrival_at: string | null; // null until a routing provider is connected
  arrived_at: string | null;
  cancelled_at: string | null;
  duration_seconds?: number | null; // only in history items
  share_live_location?: boolean;
  eta_seconds?: number | null;
  route_distance_m?: number | null;
  eta_updated_at?: string | null;
  route_polyline?: string | null;
};

export type AppNotification = {
  id: string;
  journey_id: string | null;
  sos_alert_id?: string | null;
  user_id: string;
  recipient_id: string | null;
  recipient_name: string;
  type: 'started' | 'nearby' | 'arrived' | 'cancelled' | 'sos' | 'sos_resolved';
  message: string;
  status: 'pending' | 'sent' | 'failed';
  created_at: string;
  sent_at: string | null;
};

// ---------- Family & Friends Groups ----------
export type GroupCategory = 'family' | 'friends' | 'office' | 'college' | 'custom';
export type GroupRole = 'owner' | 'admin' | 'member';

export type Group = {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  category: GroupCategory;
  icon: string;
  created_at: string;
  updated_at: string;
  my_role?: GroupRole;
  member_count?: number;
  accepted_count?: number;
  members_preview?: string[];
};

export type GroupMember = {
  id: string;
  group_id: string;
  contact_name: string;
  role: 'admin' | 'member';
  invitation_status: 'pending' | 'accepted' | 'declined';
  registered: boolean; // has an Arrive Notify account
  created_at: string;
  // only visible to the owner and admins
  user_id?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
};

export type GroupInvitation = {
  member_id: string;
  group_id: string;
  group_name: string;
  icon: string;
  category: GroupCategory;
  invited_by: string;
  created_at: string;
};

export type Contact = {
  user_id: string | null;
  contact_name: string;
  contact_email: string | null;
  contact_phone: string | null;
  accepted: boolean;
};

export type MemberInput = {
  contact_name: string;
  contact_email?: string | null;
  contact_phone?: string | null;
  role?: 'admin' | 'member';
};

// ---------- Live Journey Tracking ----------
export type RouteInfo = {
  distance_m: number;
  duration_s: number;
  polyline: string;
  points: { latitude: number; longitude: number }[];
  provider: 'osrm' | 'mapbox';
};

export type JourneyRecipient = {
  recipient_id: string | null;
  recipient_name: string;
  notification_enabled: boolean;
  can_track: boolean; // allowed to watch the live location
};

// The only row a viewer can read: the CURRENT position, never the history
export type LiveJourney = {
  journey_id: string;
  traveller_id: string;
  traveller_name: string;
  viewer_ids: string[];
  destination_name: string;
  destination_latitude: number | null;
  destination_longitude: number | null;
  status: 'active' | 'sharing_stopped' | 'arrived' | 'cancelled';
  started_at: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  position_updated_at: string | null;
  eta_seconds: number | null;
  estimated_arrival_at: string | null;
  route_distance_m: number | null;
  eta_updated_at: string | null;
  route_version: number;
  updated_at: string;
};

// ---------- Emergency SOS ----------
export type EmergencyContact = {
  id: string;
  contact_user_id: string;
  name: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
  responded_at: string | null;
};

export type EmergencyRequest = { id: string; from_name: string; created_at: string };

export type SosAlert = {
  id: string;
  user_id: string;
  sender_name: string;
  status: 'active' | 'resolved' | 'expired';
  message: string | null;
  journey_id: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  location_updated_at: string | null;
  maps_url?: string | null;
  created_at: string;
  expires_at: string;
  resolved_at: string | null;
};

export type SosRecipient = {
  recipient_id: string;
  recipient_name: string;
  response: 'seen' | 'on_my_way' | null;
  responded_at: string | null;
};
