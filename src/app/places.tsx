import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import MapView, { Marker, Circle } from 'react-native-maps';
import * as Location from 'expo-location';
import { addSavedPlace, deleteSavedPlace, getSavedPlaces, updateSavedPlace } from '../services/placesService';
import {
  Badge, Button, Card, Chip, ConfirmModal, EmptyState, Icon, IconButton, IconTile, Input, Overline, ProgressBar, Screen, ScreenHeader,
} from '../components/ui';
import { placeIcon } from '../lib/format';
import { darkMapStyle } from '../lib/mapStyle';
import { colors, radius as rad } from '../lib/theme';
import { CATEGORIES, CategoryKey, categoryOf } from '../lib/categories';
import type { LatLng } from '../lib/geo';
import type { Place } from '../lib/types';

const RADII = [100, 250, 500, 1000];
const label = (m: number) => (m >= 1000 ? `${m / 1000} km` : `${m} m`);
const WORLD = { latitude: 20, longitude: 0, latitudeDelta: 60, longitudeDelta: 60 };

export default function Places() {
  const router = useRouter();
  const { height: winH } = useWindowDimensions();
  const mapHeight = Math.round(Math.max(320, Math.min(460, winH * 0.52))); // bigger map: easier to place the pin
  const params = useLocalSearchParams<{ add?: string }>();
  const fromHome = params.add === '1'; // opened from "+ Add New Place" on Home
  const mapRef = useRef<MapView>(null);
  const addrTouched = useRef(false);

  const [places, setPlaces] = useState<Place[]>([]);
  const [loading, setLoading] = useState(true);

  // add-place form
  const [adding, setAdding] = useState(false);
  const [locating, setLocating] = useState(false);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [category, setCategory] = useState<CategoryKey>('other');
  const [radius, setRadius] = useState(500);
  const [pin, setPin] = useState<LatLng | null>(null);
  const [latText, setLatText] = useState('');
  const [lngText, setLngText] = useState('');
  const [start, setStart] = useState<LatLng | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<Place | null>(null);

  const load = useCallback(async () => {
    const res = await getSavedPlaces();
    if (!res.ok) Alert.alert('Could not load places', res.error.message);
    else setPlaces(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    if (fromHome) openForm();
  }, []);

  function applyPin(c: LatLng) {
    setPin(c);
    setLatText(c.latitude.toFixed(6));
    setLngText(c.longitude.toFixed(6));
  }

  async function fillAddress(c: LatLng) {
    if (addrTouched.current) return;
    try {
      const [r] = await Location.reverseGeocodeAsync(c);
      if (r) setAddress([r.name, r.street, r.city].filter(Boolean).join(', '));
    } catch {
      // the address is optional
    }
  }

  function movePin(c: LatLng, animate = false) {
    applyPin(c);
    setError(null);
    fillAddress(c);
    if (animate) {
      mapRef.current?.animateToRegion({ ...c, latitudeDelta: 0.006, longitudeDelta: 0.006 }, 400);
    }
  }

  async function openForm() {
    setAdding(true);
    setLocating(true);
    setError(null);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status === 'granted') {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const c = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        setStart(c);
        applyPin(c);
        fillAddress(c);
      } else {
        setError('Location permission was denied. You can still search an address, type coordinates or tap the map.');
      }
    } catch {
      setError('Could not get your location. Search an address or tap the map to place the pin.');
    } finally {
      setLocating(false);
    }
  }

  function resetForm() {
    setAdding(false);
    setName('');
    setAddress('');
    setCategory('other');
    setRadius(500);
    setPin(null);
    setLatText('');
    setLngText('');
    setStart(null);
    setError(null);
    addrTouched.current = false;
  }

  function pickCategory(k: CategoryKey) {
    setCategory(k);
    if (k !== 'other' && (name.trim() === '' || CATEGORIES.some((c) => c.label === name.trim()))) {
      setName(categoryOf(k).label);
    }
  }

  function applyTypedCoords() {
    const la = parseFloat(latText);
    const ln = parseFloat(lngText);
    if (isNaN(la) || isNaN(ln) || la < -90 || la > 90 || ln < -180 || ln > 180) {
      setError('Enter a valid latitude (-90 to 90) and longitude (-180 to 180).');
      return;
    }
    movePin({ latitude: la, longitude: ln }, true);
  }

  async function useMyLocation() {
    setError(null);
    setBusy(true);
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        setError('Location permission was denied. Allow it in your phone settings.');
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      movePin({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }, true);
    } catch (e: any) {
      setError(e?.message ?? 'Could not get your location.');
    } finally {
      setBusy(false);
    }
  }

  async function findAddress() {
    if (!address.trim()) return;
    setError(null);
    setBusy(true);
    try {
      const results = await Location.geocodeAsync(address.trim());
      if (!results.length) {
        setError('Address not found. Try more detail, or tap the map to place the pin.');
        return;
      }
      const c = { latitude: results[0].latitude, longitude: results[0].longitude };
      applyPin(c);
      mapRef.current?.animateToRegion({ ...c, latitudeDelta: 0.006, longitudeDelta: 0.006 }, 400);
    } catch {
      setError('Could not search that address. Tap the map to place the pin instead.');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setError(null);
    if (name.trim().length < 2) {
      setError('Give the place a name, like Home.');
      return;
    }
    setBusy(true);
    try {
      let point = pin;
      if (!point && address.trim()) {
        const results = await Location.geocodeAsync(address.trim());
        if (results.length) point = { latitude: results[0].latitude, longitude: results[0].longitude };
      }
      if (!point) {
        setError('Tap the map to place the pin, or search an address.');
        return;
      }
      const res = await addSavedPlace({
        name,
        category,
        address,
        latitude: point.latitude,
        longitude: point.longitude,
        arrival_radius: radius,
      });
      if (!res.ok) {
        setError(res.error.message);
        return;
      }
      resetForm();
      if (fromHome) {
        router.back(); // return to Home, where the new card appears
        return;
      }
      await load();
    } catch (e: any) {
      setError(e?.message ?? 'Could not save the place.');
    } finally {
      setBusy(false);
    }
  }

  async function doDelete() {
    const p = toDelete;
    if (!p) return;
    setToDelete(null);
    const res = await deleteSavedPlace(p.id);
    if (!res.ok) Alert.alert('Could not delete', res.error.message);
    else setPlaces((list) => list.filter((x) => x.id !== p.id));
  }

  async function toggleFavorite(p: Place) {
    const res = await updateSavedPlace(p.id, { is_favorite: !p.is_favorite });
    if (!res.ok) Alert.alert('Could not update', res.error.message);
    else setPlaces((list) => list.map((x) => (x.id === p.id ? res.data : x)));
  }

  const backAction = () => (adding && !fromHome ? resetForm() : router.back());

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Screen
        scroll
        footer={
          adding ? (
            <Button title="Save Place" icon="check" loading={busy} onPress={save} />
          ) : (
            <Button title="Add a place" icon="add" onPress={openForm} />
          )
        }
      >
        <ScreenHeader
          title={adding ? 'Add New Place' : 'Saved places'}
          subtitle={adding ? undefined : 'Where you arrive. Pick a radius for each place.'}
          onBack={backAction}
          right={!adding ? <IconButton icon="add" label="Add a place" onPress={openForm} /> : undefined}
        />

        {adding ? (
          <View style={{ gap: 18 }}>
            <View style={{ gap: 8 }}>
              <Overline>Category</Overline>
              <View style={s.chips}>
                {CATEGORIES.map((c) => (
                  <Chip key={c.key} label={c.label} icon={placeIcon(c.key)} selected={category === c.key} onPress={() => pickCategory(c.key)} />
                ))}
              </View>
            </View>

            <Input label="Place name" icon="pin" placeholder="Home, Office, College…" value={name} onChangeText={setName} />

            <Input
              label="Address"
              icon="search"
              placeholder="Address or search a location"
              value={address}
              onChangeText={(t) => {
                addrTouched.current = true;
                setAddress(t);
              }}
              onSubmitEditing={findAddress}
              returnKeyType="search"
              right={
                <Pressable onPress={findAddress} disabled={busy} hitSlop={8}>
                  <Text style={s.find}>Find</Text>
                </Pressable>
              }
            />

            <View>
              <View style={[s.mapBox, { height: mapHeight }]}>
                {locating ? (
                  <View style={s.mapLoading}>
                    <ActivityIndicator color={colors.accent} />
                    <Text style={[s.mute, { marginTop: 8 }]}>Finding your location…</Text>
                  </View>
                ) : (
                  <MapView
                    ref={mapRef}
                    style={StyleSheet.absoluteFill}
                    customMapStyle={darkMapStyle}
                    userInterfaceStyle="dark"
                    initialRegion={start ? { ...start, latitudeDelta: 0.006, longitudeDelta: 0.006 } : WORLD}
                    showsUserLocation
                    showsMyLocationButton={false}
                    onPress={(e) => movePin(e.nativeEvent.coordinate)}
                  >
                    {pin && (
                      <>
                        <Marker draggable coordinate={pin} onDragEnd={(e) => movePin(e.nativeEvent.coordinate)} pinColor={colors.route} />
                        <Circle center={pin} radius={radius} strokeColor="rgba(99,165,255,0.95)" fillColor="rgba(71,120,255,0.20)" strokeWidth={2} />
                      </>
                    )}
                  </MapView>
                )}
              </View>
              <Text style={[s.mute, { marginTop: 8 }]}>Tap the map or drag the pin to set the place.</Text>
            </View>

            <View style={s.coordRow}>
              <View style={{ flex: 1 }}>
                <Input
                  label="Latitude"
                  value={latText}
                  onChangeText={setLatText}
                  onEndEditing={applyTypedCoords}
                  keyboardType="numbers-and-punctuation"
                  placeholder="22.719600"
                />
              </View>
              <View style={{ flex: 1 }}>
                <Input
                  label="Longitude"
                  value={lngText}
                  onChangeText={setLngText}
                  onEndEditing={applyTypedCoords}
                  keyboardType="numbers-and-punctuation"
                  placeholder="75.857700"
                />
              </View>
            </View>

            <Button title="Use my current location" icon="locate" variant="secondary" disabled={busy} onPress={useMyLocation} />

            <View style={{ gap: 8 }}>
              <Overline>Tell people I have arrived when I am within</Overline>
              <View style={s.chips}>
                {RADII.map((r) => (
                  <Chip key={r} label={label(r)} selected={radius === r} onPress={() => setRadius(r)} />
                ))}
              </View>
            </View>

            {error && (
              <View style={s.error}>
                <Icon name="warning" size={16} color={colors.emergency} />
                <Text style={s.errorText}>{error}</Text>
              </View>
            )}
          </View>
        ) : loading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
        ) : places.length === 0 ? (
          <Card>
            <EmptyState icon="pin" title="No places yet" message="Add your first one, like Home." />
          </Card>
        ) : (
          <View style={{ gap: 12 }}>
            <Card tone="success" style={s.armed}>
              <Icon name="shieldCheck" size={20} color={colors.success} />
              <Text style={s.armedText}>
                {places.length} {places.length === 1 ? 'place' : 'places'} ready for arrival alerts
              </Text>
            </Card>
            {places.map((item) => (
              <Card key={item.id} style={{ gap: 12 }}>
                <View style={s.rowTop}>
                  <IconTile icon={placeIcon(item.category)} tone="blue" />
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={s.rowTitle} numberOfLines={1}>{item.name}</Text>
                    <Text style={s.mute} numberOfLines={1}>{item.address || categoryOf(item.category).label}</Text>
                  </View>
                  <Pressable onPress={() => toggleFavorite(item)} hitSlop={10} accessibilityLabel="Toggle favourite">
                    <Icon name="star" size={22} color={item.is_favorite ? colors.warning : colors.line} />
                  </Pressable>
                </View>
                <View style={{ gap: 8 }}>
                  <View style={s.radiusRow}>
                    <Text style={s.mute}>Arrival radius</Text>
                    <Badge label={`${label(item.arrival_radius)} radius`} tone="blue" caps={false} />
                  </View>
                  <ProgressBar value={Math.min(1, item.arrival_radius / 1000)} />
                </View>
                <Button title="Delete place" icon="trash" variant="secondary" small onPress={() => setToDelete(item)} />
              </Card>
            ))}
          </View>
        )}
      </Screen>

      <ConfirmModal
        visible={!!toDelete}
        tone="danger"
        title="Delete place?"
        message={`“${toDelete?.name ?? ''}” will be removed from your saved places.`}
        confirmLabel="Delete place"
        onConfirm={doDelete}
        onCancel={() => setToDelete(null)}
      />
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  mute: { color: colors.mute, fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  find: { color: colors.accent, fontWeight: '800', fontSize: 14 },
  mapBox: { height: 240, borderRadius: rad.lg, overflow: 'hidden', borderWidth: 1, borderColor: colors.line, backgroundColor: colors.card },
  mapLoading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  coordRow: { flexDirection: 'row', gap: 10 },
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  errorText: { flex: 1, color: '#FFD2C7', fontSize: 13, lineHeight: 18 },
  armed: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
  armedText: { color: colors.success, fontSize: 14, fontWeight: '800' },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  radiusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
});
