export type CreativeProps = {
  format: {
    width: number;
    height: number;
    fps: number;
    duration_seconds: number;
  };
  assets: Record<string, string>;
  copy: Record<string, string>;
  brand: {
    badge_text: string;
  };
};
