import { Tabs } from 'expo-router';
import { View } from 'react-native';
import { Heart, Skull, Fish, Camera, Sparkles } from 'lucide-react-native';
import { StatusBar } from 'expo-status-bar';

// 统一 Y2K 掌机复古电子配色
const C_BG = '#FFFDF2';
const C_PINK = '#FF5E7C';
const C_PURPLE = '#6C63FF';
const C_INACTIVE = '#A39E92';
const C_BORDER = '#2D2A26';

export default function TabsLayout() {
  return (
    <>
      <StatusBar style="dark" backgroundColor={C_BG} />
      <Tabs
        initialRouteName="home"
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: C_PINK,
          tabBarInactiveTintColor: C_INACTIVE,
          tabBarStyle: {
            backgroundColor: '#FFFFFF',
            borderTopColor: C_BORDER,
            borderTopWidth: 2,
            height: 72,
            paddingBottom: 10,
            paddingTop: 8,
            boxShadow: [{ offsetX: 0, offsetY: -3, blurRadius: 0, color: 'rgba(45,42,38,0.06)' }],
          },
          tabBarLabelStyle: {
            fontSize: 11,
            fontWeight: 'bold',
            marginTop: 2,
          },
        }}
      >
        <Tabs.Screen
          name="home"
          options={{
            title: '状态',
            tabBarIcon: ({ color, size, focused }) => (
              <View style={{
                padding: 4,
                borderRadius: 8,
                backgroundColor: focused ? 'rgba(255,94,124,0.12)' : 'transparent',
              }}>
                <Heart size={size - 2} color={color} strokeWidth={focused ? 2.5 : 2} />
              </View>
            ),
          }}
        />
        <Tabs.Screen
          name="ddl"
          options={{
            title: 'DDL',
            tabBarActiveTintColor: C_PURPLE,
            tabBarIcon: ({ color, size, focused }) => (
              <View style={{
                padding: 4,
                borderRadius: 8,
                backgroundColor: focused ? 'rgba(108,99,255,0.12)' : 'transparent',
              }}>
                <Skull size={size - 2} color={color} strokeWidth={focused ? 2.5 : 2} />
              </View>
            ),
          }}
        />
        <Tabs.Screen
          name="slack"
          options={{
            title: '摸鱼',
            tabBarActiveTintColor: '#2EC4B6',
            tabBarIcon: ({ color, size, focused }) => (
              <View style={{
                padding: 4,
                borderRadius: 8,
                backgroundColor: focused ? 'rgba(46,196,182,0.12)' : 'transparent',
              }}>
                <Fish size={size - 2} color={color} strokeWidth={focused ? 2.5 : 2} />
              </View>
            ),
          }}
        />
        <Tabs.Screen
          name="card"
          options={{
            title: '卡片',
            tabBarActiveTintColor: '#FF8C00',
            tabBarIcon: ({ color, size, focused }) => (
              <View style={{
                padding: 4,
                borderRadius: 8,
                backgroundColor: focused ? 'rgba(255,140,0,0.12)' : 'transparent',
              }}>
                <Camera size={size - 2} color={color} strokeWidth={focused ? 2.5 : 2} />
              </View>
            ),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: '设置',
            tabBarActiveTintColor: C_PINK,
            tabBarIcon: ({ color, size, focused }) => (
              <View style={{
                padding: 4,
                borderRadius: 8,
                backgroundColor: focused ? 'rgba(255,94,124,0.12)' : 'transparent',
              }}>
                <Sparkles size={size - 2} color={color} strokeWidth={focused ? 2.5 : 2} />
              </View>
            ),
          }}
        />
      </Tabs>
    </>
  );
}
