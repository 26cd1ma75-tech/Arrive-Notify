import { SymbolView, type AndroidSymbol, type SymbolViewProps } from 'expo-symbols';
import { colors, size as sizes } from '../../lib/theme';

// One icon set for the whole app. Each icon has an iOS (SF Symbols) and an Android
// (Material Symbols) name, both checked by TypeScript, so a wrong name fails the build.
type SF = Extract<SymbolViewProps['name'], string>;
type Def = { ios: SF; android: AndroidSymbol };

const ICONS = {
  home: { ios: 'house.fill', android: 'home' },
  journey: { ios: 'location.north.fill', android: 'navigation' },
  groups: { ios: 'person.2.fill', android: 'group' },
  history: { ios: 'clock.arrow.circlepath', android: 'history' },
  profile: { ios: 'person.fill', android: 'person' },
  back: { ios: 'chevron.left', android: 'arrow_back' },
  chevron: { ios: 'chevron.right', android: 'chevron_right' },
  close: { ios: 'xmark', android: 'close' },
  add: { ios: 'plus', android: 'add' },
  check: { ios: 'checkmark', android: 'check' },
  checkCircle: { ios: 'checkmark.circle.fill', android: 'check_circle' },
  cancel: { ios: 'xmark.circle.fill', android: 'cancel' },
  warning: { ios: 'exclamationmark.triangle.fill', android: 'warning' },
  sos: { ios: 'exclamationmark.octagon.fill', android: 'sos' },
  pin: { ios: 'mappin.circle.fill', android: 'location_on' },
  office: { ios: 'building.2.fill', android: 'apartment' },
  school: { ios: 'graduationcap.fill', android: 'school' },
  gym: { ios: 'dumbbell.fill', android: 'fitness_center' },
  bell: { ios: 'bell.fill', android: 'notifications' },
  bellOff: { ios: 'bell.slash.fill', android: 'notifications_off' },
  shield: { ios: 'shield.fill', android: 'shield' },
  shieldCheck: { ios: 'checkmark.shield.fill', android: 'verified_user' },
  lock: { ios: 'lock.fill', android: 'lock' },
  call: { ios: 'phone.fill', android: 'call' },
  share: { ios: 'square.and.arrow.up', android: 'share' },
  clock: { ios: 'clock.fill', android: 'schedule' },
  trash: { ios: 'trash.fill', android: 'delete' },
  edit: { ios: 'pencil', android: 'edit' },
  search: { ios: 'magnifyingglass', android: 'search' },
  logout: { ios: 'rectangle.portrait.and.arrow.right', android: 'logout' },
  info: { ios: 'info.circle.fill', android: 'info' },
  map: { ios: 'map.fill', android: 'map' },
  eye: { ios: 'eye.fill', android: 'visibility' },
  eyeOff: { ios: 'eye.slash.fill', android: 'visibility_off' },
  contacts: { ios: 'person.crop.circle.fill', android: 'contacts' },
  personAdd: { ios: 'person.badge.plus', android: 'person_add' },
  groupAdd: { ios: 'person.crop.circle.badge.plus', android: 'group_add' },
  link: { ios: 'link', android: 'link' },
  locate: { ios: 'location.fill', android: 'my_location' },
  locationOff: { ios: 'location.slash.fill', android: 'location_off' },
  refresh: { ios: 'arrow.clockwise', android: 'sync' },
  stop: { ios: 'stop.circle.fill', android: 'stop_circle' },
  timer: { ios: 'timer', android: 'timer' },
  mail: { ios: 'envelope.fill', android: 'mail' },
  settings: { ios: 'gearshape.fill', android: 'settings' },
  flag: { ios: 'flag.fill', android: 'flag' },
  car: { ios: 'car.fill', android: 'directions_car' },
  star: { ios: 'star.fill', android: 'star' },
  wifiOff: { ios: 'wifi.slash', android: 'wifi_off' },
  send: { ios: 'paperplane.fill', android: 'send' },
  radar: { ios: 'dot.radiowaves.left.and.right', android: 'sensors' },
  privacy: { ios: 'hand.raised.fill', android: 'privacy_tip' },
  phone: { ios: 'iphone', android: 'phone_android' },
  heart: { ios: 'heart.fill', android: 'favorite' },
  gps: { ios: 'location.circle.fill', android: 'gps_fixed' },
  speed: { ios: 'speedometer', android: 'speed' },
  tune: { ios: 'slider.horizontal.3', android: 'tune' },
  help: { ios: 'questionmark.circle.fill', android: 'help_outline' },
  qr: { ios: 'qrcode', android: 'qr_code_2' },
  scan: { ios: 'qrcode.viewfinder', android: 'qr_code_scanner' },
  download: { ios: 'arrow.down.circle.fill', android: 'download' },
  flash: { ios: 'flashlight.on.fill', android: 'flashlight_on' },
  flashOff: { ios: 'flashlight.off.fill', android: 'flashlight_off' },
  camera: { ios: 'camera.fill', android: 'photo_camera' },
} satisfies Record<string, Def>;

export type IconName = keyof typeof ICONS;

export default function Icon({ name, size = sizes.icon, color = colors.ink }: { name: IconName; size?: number; color?: string }) {
  const d = ICONS[name];
  return <SymbolView name={{ ios: d.ios, android: d.android, web: d.android }} size={size} tintColor={color} />;
}
