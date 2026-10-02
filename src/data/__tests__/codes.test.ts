import { CALLBACK_OUTCOMES, COMPLAINTS, DISCHARGE_BABY, DISCHARGE_MOTHER, MISSED_OUTCOMES, WARNING_SIGNS } from '../catalogue';
import {
  callbackOutcomeCodes,
  complaintCodes,
  complicationCodes,
  contactOutcomeCodes,
  counsellingCodes,
  deliveryModeCodes,
  dischargeLabel,
  followUpCodes,
  labourMedicineCodes,
  previousOutcomeCodes,
  signLabel,
  splitComplaints,
} from '../codes';

// The server refuses unknown codes (supabase/seed.sql pick lists). Every option a screen offers must map to one.
describe('screen options → server codes', () => {
  it('covers every complaint, outcome and follow-up the forms offer', () => {
    for (const c of COMPLAINTS) expect(complaintCodes.code(c)).toBeDefined();
    for (const c of CALLBACK_OUTCOMES) expect(callbackOutcomeCodes.code(c)).toBeDefined();
    for (const c of MISSED_OUTCOMES) expect(contactOutcomeCodes.code(c)).toBeDefined();
    for (const c of ['None', 'Repeat test', 'Refer', 'Discuss at next visit']) expect(followUpCodes.code(c)).toBeDefined();
    for (const c of ['Nutrition', 'Warning signs', 'Birth preparedness', 'Breastfeeding', 'Family planning']) expect(counsellingCodes.code(c)).toBeDefined();
  });

  it('covers the delivery form', () => {
    for (const c of ['Normal vaginal', 'Assisted (vacuum/forceps)', 'LSCS (elective)', 'LSCS (emergency)']) expect(deliveryModeCodes.code(c)).toBeDefined();
    for (const c of ['PPH', 'Eclampsia', 'Retained placenta', 'Perineal tear', 'Other']) expect(complicationCodes.code(c)).toBeDefined();
    for (const c of ['Oxytocin', 'MgSO4', 'Antibiotics', 'Blood transfusion', 'Steroids (antenatal)']) expect(labourMedicineCodes.code(c)).toBeDefined();
    for (const c of ['Live birth', 'Stillbirth', 'Miscarriage', 'MTP']) expect(previousOutcomeCodes.code(c)).toBeDefined();
  });

  it('uses the server codes the pick lists define', () => {
    expect(contactOutcomeCodes.code('Delivered elsewhere')).toBe('delivered_elsewhere');
    expect(callbackOutcomeCodes.code('Advised to come in')).toBe('advised_to_come');
    expect(deliveryModeCodes.code('LSCS (emergency)')).toBe('lscs_emergency');
    expect(followUpCodes.code('Discuss at next visit')).toBe('discuss_next_visit');
  });

  it('round-trips codes to labels', () => {
    expect(complaintCodes.label(complaintCodes.code('Reduced fetal movements')!)).toBe('Reduced fetal movements');
    expect(signLabel('movements')).toBe(WARNING_SIGNS.pregnancy.movements);
    for (const d of [...DISCHARGE_MOTHER, ...DISCHARGE_BABY]) expect(dischargeLabel(d.key)).toBe(d.label);
  });

  it('keeps free-text complaints out of the coded list', () => {
    expect(splitComplaints(['Headache', 'Other: back ache'])).toEqual({ codes: ['headache'], note: 'Other: back ache' });
    expect(splitComplaints([])).toEqual({ codes: [], note: undefined });
  });
});
