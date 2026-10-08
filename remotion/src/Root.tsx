import './index.css';
import { Composition } from 'remotion';
import { PosterStill } from './templates/PosterStill';
import type { CreativeProps } from './shared/types';
import example from '../../examples/poster-1x1.json';

export const RemotionRoot = () => (
  <Composition
    id="PosterStill"
    component={PosterStill}
    width={1080}
    height={1080}
    fps={30}
    durationInFrames={120}
    defaultProps={example as CreativeProps}
    calculateMetadata={({ props }) => ({
      width: props.format.width,
      height: props.format.height,
      fps: props.format.fps,
      durationInFrames: Math.round(props.format.duration_seconds * props.format.fps),
    })}
  />
);
