import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import AnimatedLogo, { Wordmark } from '../components/brand/AnimatedLogo';
import { Button, Card, Icon, Input, Screen } from '../components/ui';
import { supabase } from '../lib/supabase';
import { colors, type } from '../lib/theme';

type Mode = 'signin' | 'signup';

export default function Login() {
  const [mode, setMode] = useState<Mode>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const isSignup = mode === 'signup';

  function validate(): string | null {
    if (isSignup && name.trim().length < 2) return 'Please enter your name.';
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return 'Enter a valid email address.';
    if (password.length < 6) return 'Password must be at least 6 characters.';
    return null;
  }

  async function submit() {
    setError(null);
    setInfo(null);
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      if (isSignup) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { data: { name: name.trim() } },
        });
        if (error) throw error;
        // If email confirmation is ON in Supabase, there is no session yet
        if (!data.session) setInfo('Account created. Check your email to confirm, then log in.');
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      }
      // On success the app redirects to Home automatically
    } catch (e: any) {
      setError(e?.message ?? 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function switchMode() {
    setMode(isSignup ? 'signin' : 'signup');
    setError(null);
    setInfo(null);
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
      <Screen scroll contentStyle={{ flexGrow: 1, justifyContent: 'center' }}>
        <View style={s.brand}>
          <AnimatedLogo size={46} delay={100} />
          <View style={{ marginLeft: 6 }}>
            <Wordmark fontSize={20} delay={420} />
          </View>
        </View>

        <Text style={type.display}>Don’t text.</Text>
        <Text style={[type.display, { color: colors.accent }]}>Just arrive.</Text>
        <Text style={s.sub}>
          {isSignup ? 'Create your account to get started.' : 'Log in to start your journey.'}
        </Text>

        <Card style={{ gap: 14, padding: 18 }}>
          {isSignup && (
            <Input
              label="Name"
              icon="profile"
              placeholder="Your name"
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              textContentType="name"
            />
          )}
          <Input
            label="Email"
            icon="mail"
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            textContentType="emailAddress"
          />
          <Input
            label="Password"
            icon="lock"
            placeholder="Min 6 characters"
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPw}
            autoCapitalize="none"
            textContentType={isSignup ? 'newPassword' : 'password'}
            onSubmitEditing={submit}
            right={
              <Pressable onPress={() => setShowPw(!showPw)} hitSlop={10}>
                <Text style={s.show}>{showPw ? 'Hide' : 'Show'}</Text>
              </Pressable>
            }
          />

          {error && (
            <View style={s.msg}>
              <Icon name="warning" size={16} color={colors.emergency} />
              <Text style={[s.msgText, { color: '#FFD2C7' }]}>{error}</Text>
            </View>
          )}
          {info && (
            <View style={s.msg}>
              <Icon name="checkCircle" size={16} color={colors.success} />
              <Text style={[s.msgText, { color: colors.success }]}>{info}</Text>
            </View>
          )}

          <Button title={isSignup ? 'Create account' : 'Log in'} loading={busy} onPress={submit} />
        </Card>

        <Pressable onPress={switchMode} style={{ marginTop: 22, padding: 6 }}>
          <Text style={s.switch}>
            {isSignup ? 'Already have an account? ' : 'New here? '}
            <Text style={{ color: colors.accent, fontWeight: '800' }}>{isSignup ? 'Log in' : 'Create an account'}</Text>
          </Text>
        </Pressable>
      </Screen>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 40 },
  mark: { width: 34, height: 34, borderRadius: 11, backgroundColor: colors.route, alignItems: 'center', justifyContent: 'center' },
  brandName: { color: colors.ink, fontSize: 18, fontWeight: '800', letterSpacing: -0.2 },
  sub: { color: colors.mute, marginTop: 12, marginBottom: 26, fontSize: 15, lineHeight: 21 },
  show: { color: colors.accent, fontWeight: '700', fontSize: 13 },
  msg: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  msgText: { flex: 1, fontSize: 13, lineHeight: 18 },
  switch: { color: colors.mute, textAlign: 'center', fontSize: 14 },
});
