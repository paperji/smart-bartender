import { forwardRef, useState } from 'react';
import { Platform, StyleSheet, TextInput, View, type StyleProp, type TextInputInstance, type TextInputProps, type ViewStyle } from 'react-native';

import { colors, radius, space, type as typo } from '@/constants/theme';

import { AppText } from './Text';

export interface TextFieldProps extends TextInputProps {
  label?: string;
  helper?: string;
  error?: string;
  containerStyle?: StyleProp<ViewStyle>;
  suffix?: string;
}

export const TextField = forwardRef<TextInputInstance, TextFieldProps>(function TextField(
  { label, helper, error, containerStyle, style, suffix, multiline, onFocus, onBlur, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[{ gap: 6 }, containerStyle]}>
      {label ? <AppText variant="label" tone="secondary">{label}</AppText> : null}
      <View
        style={[
          styles.box,
          multiline ? { minHeight: 96, alignItems: 'flex-start', paddingVertical: space.md } : null,
          { borderColor: error ? colors.danger : focused ? colors.primaryBorder : colors.border },
        ]}>
        <TextInput
          ref={ref}
          placeholderTextColor={colors.textDisabled}
          selectionColor={colors.primary}
          cursorColor={colors.primary}
          multiline={multiline}
          textAlignVertical={multiline ? 'top' : 'center'}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          style={[styles.input, multiline ? { minHeight: 72 } : null, style]}
          {...rest}
        />
        {suffix ? (
          <AppText variant="label" tone="muted">
            {suffix}
          </AppText>
        ) : null}
      </View>
      {error ? (
        <AppText variant="caption" tone="danger">
          {error}
        </AppText>
      ) : helper ? (
        <AppText variant="caption" tone="muted">
          {helper}
        </AppText>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  box: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    backgroundColor: colors.cardAlt,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    minHeight: 48,
  },
  input: {
    flex: 1,
    color: colors.text,
    ...typo.body,
    paddingVertical: 10,
    // 웹 기본 포커스 테두리 제거 (테두리 색으로 포커스 표시)
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null),
  },
});
