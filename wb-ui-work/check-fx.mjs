import { installPhaserEnv } from '../tests/helpers/phaser-env.mjs';
installPhaserEnv();
const Phaser = (await import('phaser/dist/phaser.js')).default;
console.log('version', Phaser.VERSION);
const proto = Phaser.Cameras.Scene2D.BaseCamera.prototype;
console.log('camera postFX getter:', Object.getOwnPropertyDescriptor(proto, 'postFX') ? 'yes' : 'no');
const fxp = Phaser.GameObjects.Components.FX.prototype;
console.log('addColorMatrix', typeof fxp.addColorMatrix, '| addBlur', typeof fxp.addBlur);
console.log('grayscale', typeof Phaser.Display.ColorMatrix.prototype.grayscale);
