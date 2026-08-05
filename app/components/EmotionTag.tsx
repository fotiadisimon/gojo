import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { EMOTION_COLORS, EMOTION_LABELS } from '../constants/theme';

interface Props {
  emotion: string;
}

export default function EmotionTag({ emotion }: Props) {
  const color = EMOTION_COLORS[emotion] || EMOTION_COLORS['平静'];
  const emoji = EMOTION_LABELS[emotion] || '';
  return (
    <View style={[s.wrap, { backgroundColor: color + '33', borderColor: color }]}>
      <Text style={[s.text, { color }]}>{emoji} {emotion}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
    marginTop: 4,
  },
  text: {
    fontSize: 11,
    fontWeight: '600',
  },
});
