const { escapeHtml } = require('../lib/escape-html');

describe('escapeHtml', () => {
  test('escapa < y >', () => {
    expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  test('escapa &', () => {
    expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
  });

  test('escapa comillas dobles y simples', () => {
    expect(escapeHtml('"hola" \'mundo\'')).toBe('&quot;hola&quot; &#x27;mundo&#x27;');
  });

  test('strings seguros pasan sin cambios', () => {
    expect(escapeHtml('Ana Torres')).toBe('Ana Torres');
    expect(escapeHtml('Medellín')).toBe('Medellín');
  });

  test('null y undefined devuelven string vacío', () => {
    expect(escapeHtml(null)).toBe('');
    expect(escapeHtml(undefined)).toBe('');
  });

  test('números se convierten a string', () => {
    expect(escapeHtml(95000)).toBe('95000');
  });
});
