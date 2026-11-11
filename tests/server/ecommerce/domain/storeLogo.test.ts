import { describe, it, expect } from 'vitest';
import {
  publicAssetUrl,
  logoDisplaySize,
  storeLogoVariables,
} from '../../../../server/src/services/modules/ecommerce/domain/storeLogo';

describe('publicAssetUrl', () => {
  it('keeps absolute URLs that are not the backoffice', () => {
    expect(publicAssetUrl('https://cdn.example.com/l.png', 'https://shop.example', 'http://localhost:1337')).toBe(
      'https://cdn.example.com/l.png'
    );
  });
  it('serves root-relative paths from the storefront', () => {
    expect(publicAssetUrl('/uploads/l.png', 'https://shop.example/', null)).toBe('https://shop.example/uploads/l.png');
    expect(publicAssetUrl('/uploads/l.png', null)).toBe('');
  });
  it('drops anything else', () => {
    expect(publicAssetUrl('uploads/l.png', 'https://shop.example')).toBe('');
    expect(publicAssetUrl(null, 'https://shop.example')).toBe('');
  });
  it('rewrites URLs on the backoffice origin onto the storefront, or drops them', () => {
    expect(publicAssetUrl('http://localhost:1337/uploads/l.png', 'https://shop.example', 'http://localhost:1337')).toBe(
      'https://shop.example/uploads/l.png'
    );
    expect(publicAssetUrl('http://localhost:1337/uploads/l.png', null, 'http://localhost:1337')).toBe('');
  });
  it('matches the backoffice by host name, whatever the scheme or port', () => {
    expect(publicAssetUrl('http://CMS.example.com/uploads/l.png', 'https://shop.example', 'https://cms.example.com')).toBe(
      'https://shop.example/uploads/l.png'
    );
    expect(publicAssetUrl('https://cms.example.com:8443/uploads/l.png', null, 'https://cms.example.com')).toBe('');
  });
  it('treats protocol-relative URLs as https', () => {
    expect(publicAssetUrl('//cdn.example.com/l.png', null)).toBe('https://cdn.example.com/l.png');
  });
});

describe('logoDisplaySize', () => {
  it('fits 240x48 without enlarging', () => {
    expect(logoDisplaySize(480, 96)).toEqual({ width: 240, height: 48 });
    expect(logoDisplaySize(200, 40)).toEqual({ width: 200, height: 40 });
    expect(logoDisplaySize(480, 40)).toEqual({ width: 240, height: 20 });
    expect(logoDisplaySize(96, 96)).toEqual({ width: 48, height: 48 });
  });
});

describe('storeLogoVariables', () => {
  it('is empty without a logo', () => {
    expect(storeLogoVariables({ logo: null, storefrontUrl: 'https://shop.example' })).toEqual({
      logoUrl: '',
      logoWidth: '',
      logoHeight: '',
    });
  });
});
