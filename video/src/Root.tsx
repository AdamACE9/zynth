import React from 'react';
import { Composition } from 'remotion';
import { EndCard } from './EndCard';
import { VIDEO } from './theme';

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="EndCard"
      component={EndCard}
      durationInFrames={VIDEO.durationInFrames}
      fps={VIDEO.fps}
      width={VIDEO.width}
      height={VIDEO.height}
    />
  );
};
