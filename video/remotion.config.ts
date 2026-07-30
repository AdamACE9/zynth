import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
// The card is mostly flat colour over gradients; CRF 18 keeps the wordmark
// gradient and node glow free of banding without a silly file size.
Config.setCrf(18);
