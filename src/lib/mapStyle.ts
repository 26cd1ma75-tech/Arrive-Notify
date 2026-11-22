import type { MapStyleElement } from 'react-native-maps';

// Dark navy map so routes and markers stay readable against the dark interface.
// Used on Android (Google Maps). iOS uses userInterfaceStyle="dark" instead.
export const darkMapStyle: MapStyleElement[] = [
  { elementType: 'geometry', stylers: [{ color: '#0d1530' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8fa0c8' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#080d20' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#26386e' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#0b1229' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1c2a55' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#0d1530' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2a3d7a' }] },
  { featureType: 'road', elementType: 'labels.text.fill', stylers: [{ color: '#7d8db5' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#060a1a' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#4b5a85' }] },
];
