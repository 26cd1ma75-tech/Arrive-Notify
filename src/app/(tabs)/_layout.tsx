import { View } from 'react-native';
import { Tabs } from 'expo-router/js-tabs';
import { Icon, IconName } from '../../components/ui';
import { colors } from '../../lib/theme';

// Active tab gets a soft blue pill behind its icon, like the reference deck
function TabIcon({ name, focused }: { name: IconName; focused: boolean }) {
  return (
    <View
      style={{
        width: 54, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center',
        backgroundColor: focused ? colors.routeSoft : 'transparent',
      }}
    >
      <Icon name={name} size={22} color={focused ? colors.accent : colors.dim} />
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.dim,
        tabBarStyle: { backgroundColor: '#0A1230', borderTopColor: colors.lineSoft, borderTopWidth: 1, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '700' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: ({ focused }) => <TabIcon name="home" focused={focused} /> }} />
      <Tabs.Screen name="trips" options={{ title: 'Journey', tabBarIcon: ({ focused }) => <TabIcon name="journey" focused={focused} /> }} />
      <Tabs.Screen name="groups" options={{ title: 'Groups', tabBarIcon: ({ focused }) => <TabIcon name="groups" focused={focused} /> }} />
      <Tabs.Screen name="history" options={{ title: 'History', tabBarIcon: ({ focused }) => <TabIcon name="history" focused={focused} /> }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: ({ focused }) => <TabIcon name="profile" focused={focused} /> }} />
    </Tabs>
  );
}
