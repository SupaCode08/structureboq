import test from 'node:test';
import assert from 'node:assert/strict';
import { ocrRaster } from './ocr.ts';

test('ocrRaster with crop passes cropped tiles without rectangle option and offsets word coordinates', async () => {
  const width = 3000;
  const height = 2000;
  const fullImage = 'full-page-image';

  // Record calls without crop
  const callsWithoutCrop: { image: any; options?: any }[] = [];
  const workerWithoutCrop = {
    recognize: async (image: any, options?: any) => {
      callsWithoutCrop.push({ image, options });
      return { data: { words: [] } };
    },
  };
  await ocrRaster(workerWithoutCrop, fullImage, width, height);

  // Record calls with crop
  const callsWithCrop: { image: any; options?: any }[] = [];
  const croppedRects: { left: number; top: number; width: number; height: number }[] = [];
  const workerWithCrop = {
    recognize: async (image: any, options?: any) => {
      callsWithCrop.push({ image, options });
      if (image && image.left === 1848 && image.top === 0) {
        return {
          data: {
            words: [
              {
                text: 'WORD',
                confidence: 90,
                bbox: { x0: 10, y0: 20, x1: 30, y1: 40 },
              },
            ],
          },
        };
      }
      return { data: { words: [] } };
    },
  };

  const crop = async (rect: { left: number; top: number; width: number; height: number }) => {
    croppedRects.push(rect);
    return { cropped: true, left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  };

  const words = await ocrRaster(workerWithCrop, fullImage, width, height, { crop });

  // Assert the same tiles are visited as without crop
  assert.equal(croppedRects.length, callsWithoutCrop.length);
  assert.deepEqual(croppedRects, callsWithoutCrop.map(c => c.options.rectangle));

  // Assert every call with crop gets the cropped image and no rectangle
  assert.equal(callsWithCrop.length, croppedRects.length);
  for (let i = 0; i < callsWithCrop.length; i++) {
    assert.deepEqual(callsWithCrop[i].image, {
      cropped: true,
      left: croppedRects[i].left,
      top: croppedRects[i].top,
      width: croppedRects[i].width,
      height: croppedRects[i].height,
    });
    assert.equal(callsWithCrop[i].options, undefined);
  }

  // Assert word coordinates offset
  assert.equal(words.length, 1);
  const w = words[0];
  assert.equal(w.text, 'WORD');
  assert.equal(w.conf, 90);
  assert.equal(w.x0, (1848 + 10) / width);
  assert.equal(w.y0, (0 + 20) / height);
  assert.equal(w.x1, (1848 + 30) / width);
  assert.equal(w.y1, (0 + 40) / height);
});
