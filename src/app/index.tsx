import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View, ActivityIndicator } from 'react-native';

const ONBOARDING_KEY = 'ddl_onboarded_v1';

export default function Index() {
  const [checked, setChecked] = useState(false);
  const [onboarded, setOnboarded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_KEY).then(val => {
      setOnboarded(val === '1');
      setChecked(true);
    }).catch(() => {
      setOnboarded(true); // 读取失败默认跳过引导
      setChecked(true);
    });
  }, []);

  if (!checked) {
    return (
      <View style={{ flex: 1, backgroundColor: '#FFFDF2', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#FF5E7C" />
      </View>
    );
  }

  if (!onboarded) {
    return <Redirect href="/onboarding" />;
  }

  return <Redirect href="/(app)/(tabs)/home" />;
}
