import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { reportVerifiedCell, sheetValuesMatch } from '../src/sheetReadback.js';

describe('Google Sheets live readback', () => {
  it('matches numeric cell value from Google formatting', () => {
    assert.equal(sheetValuesMatch(6, '6'), true);
    assert.equal(sheetValuesMatch('6,0', 6), true);
    assert.equal(sheetValuesMatch('6', '7'), false);
  });
  it('reports actual field and whether value changed', () => {
    assert.deepEqual(reportVerifiedCell('L6', 'Frecuencia', '3', '6'), {
      cell: 'L6', field: 'Frecuencia', before: '3', after: '6',
      changed: true, verified: true,
    });
    assert.equal(reportVerifiedCell('M6', 'UnidadTiempo', 'Mes', 'Mes').changed, false);
  });
  it('rejects unequal time units and missing readback', () => {
    assert.equal(sheetValuesMatch('Mes', 'año'), false);
    assert.equal(sheetValuesMatch('Mes', undefined), false);
  });
});
