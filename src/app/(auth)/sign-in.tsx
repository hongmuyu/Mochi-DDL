// 纯本地 App 无需登录，此文件为占位路由（不可达）
import { Redirect } from 'expo-router';

export default function SignIn() {
  return <Redirect href="/(app)/(tabs)/home" />;
}
