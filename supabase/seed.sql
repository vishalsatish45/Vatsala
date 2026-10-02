-- Reference seed: one synthetic hospital, its teams, demo staff, and the hospital-configurable catalogues
-- (PRD §10). Fake data only — these people and this hospital do not exist.
-- Demo patients are loaded separately by reset_demo() from the app's buildSeed().
-- Fixed UUIDs so tests and the app's demo accounts can refer to them.
--
-- Catalogue notes
--  * min/max_possible are impossible-value guards for data entry, deliberately wide. They are not clinical
--    ranges and nothing in the product compares a value against them for display.
--  * Units are UCUM. LOINC codes are mapping hints for a future ABDM/FHIR export and must be verified.
--  * Pick-list codes mirror the app's option lists (src/data/catalogue.ts and the forms); the app stores codes
--    and shows the label in the user's language. kn/hi labels are added once reviewed.

insert into public.hospitals (id, name, code, phone_opd, phone_labour, address, district, state, settings) values
  ('00000000-0000-4000-8000-000000000001', 'Demo District Hospital', 'DDH',
   '919000001000', '919000001001', 'Demo Road', 'Demo District', 'Karnataka',
   '{"quiet_hours":{"from":"21:00","to":"07:00"}}');

-- Departments receive referrals; units own patients.
insert into public.teams (id, hospital_id, name, kind, specialty, parent_team_id) values
  ('00000000-0000-4000-8001-000000000001', '00000000-0000-4000-8000-000000000001', 'Obstetrics',       'department', 'obstetrics',  null),
  ('00000000-0000-4000-8001-000000000002', '00000000-0000-4000-8000-000000000001', 'Paediatrics',      'department', 'paediatrics', null),
  ('00000000-0000-4000-8001-000000000003', '00000000-0000-4000-8000-000000000001', 'Cardiology',       'department', 'other',       null),
  ('00000000-0000-4000-8001-000000000004', '00000000-0000-4000-8000-000000000001', 'General Medicine', 'department', 'other',       null),
  ('00000000-0000-4000-8001-000000000005', '00000000-0000-4000-8000-000000000001', 'Endocrinology',    'department', 'other',       null),
  ('00000000-0000-4000-8001-000000000006', '00000000-0000-4000-8000-000000000001', 'Anaesthesia',      'department', 'other',       null),
  ('00000000-0000-4000-8001-000000000007', '00000000-0000-4000-8000-000000000001', 'Psychiatry',       'department', 'other',       null),
  ('00000000-0000-4000-8001-000000000008', '00000000-0000-4000-8000-000000000001', 'Nephrology',       'department', 'other',       null),
  ('00000000-0000-4000-8001-000000000009', '00000000-0000-4000-8000-000000000001', 'Radiology',        'department', 'other',       null);
insert into public.teams (id, hospital_id, name, kind, specialty, parent_team_id) values
  ('00000000-0000-4000-8001-0000000000a1', '00000000-0000-4000-8000-000000000001', 'OB Unit A',        'unit', 'obstetrics',  '00000000-0000-4000-8001-000000000001'),
  ('00000000-0000-4000-8001-0000000000a2', '00000000-0000-4000-8000-000000000001', 'Paediatrics Unit', 'unit', 'paediatrics', '00000000-0000-4000-8001-000000000002');

-- Demo staff (src/features/auth/demoAccounts.ts). Dr. Meera is also a mother; her mother row comes with the patients.
insert into public.staff (id, hospital_id, phone, name, role) values
  ('00000000-0000-4000-8002-000000000001', '00000000-0000-4000-8000-000000000001', '919000000001', 'Dr. Priya Rao',   'obstetrician'),
  ('00000000-0000-4000-8002-000000000002', '00000000-0000-4000-8000-000000000001', '919000000002', 'Dr. Arjun Menon', 'paediatrician'),
  ('00000000-0000-4000-8002-000000000007', '00000000-0000-4000-8000-000000000001', '919000000007', 'Dr. Kiran Shah',  'specialist'),
  ('00000000-0000-4000-8002-000000000005', '00000000-0000-4000-8000-000000000001', '919000000005', 'Dr. Meera S',     'obstetrician');

insert into public.team_members (team_id, staff_id) values
  ('00000000-0000-4000-8001-0000000000a1', '00000000-0000-4000-8002-000000000001'),   -- Priya: OB Unit A
  ('00000000-0000-4000-8001-000000000001', '00000000-0000-4000-8002-000000000001'),   --        Obstetrics
  ('00000000-0000-4000-8001-0000000000a1', '00000000-0000-4000-8002-000000000005'),   -- Meera: OB Unit A
  ('00000000-0000-4000-8001-000000000001', '00000000-0000-4000-8002-000000000005'),   --        Obstetrics
  ('00000000-0000-4000-8001-0000000000a2', '00000000-0000-4000-8002-000000000002'),   -- Arjun: Paediatrics Unit
  ('00000000-0000-4000-8001-000000000002', '00000000-0000-4000-8002-000000000002'),   --        Paediatrics
  ('00000000-0000-4000-8001-000000000003', '00000000-0000-4000-8002-000000000007');   -- Kiran: Cardiology

-- Pick lists (codes the app stores; labels shown in the user's language).
insert into public.pick_lists (list, code, label, grp, sort) values
  -- Warning signs (PRD F-42, §10.6): static education; ticked signs are stored, never evaluated.
  ('warning_sign', 'bleeding',        '{"en":"Bleeding"}',                         'pregnancy', 1),
  ('warning_sign', 'headache_vision', '{"en":"Severe headache / blurred vision"}', 'pregnancy', 2),
  ('warning_sign', 'fits',            '{"en":"Fits"}',                             'pregnancy', 3),
  ('warning_sign', 'leaking',         '{"en":"Leaking water"}',                    'pregnancy', 4),
  ('warning_sign', 'movements',       '{"en":"Baby moving less"}',                 'pregnancy', 5),
  ('warning_sign', 'belly_pain',      '{"en":"Severe belly pain"}',                'pregnancy', 6),
  ('warning_sign', 'fever',           '{"en":"High fever"}',                       'pregnancy', 7),
  ('warning_sign', 'breathless',      '{"en":"Difficulty breathing"}',             'pregnancy', 8),
  ('warning_sign', 'swelling',        '{"en":"Swollen face or hands"}',            'pregnancy', 9),
  ('warning_sign', 'heavy_bleeding',  '{"en":"Heavy bleeding"}',                   'postnatal', 1),
  ('warning_sign', 'pn_fever',        '{"en":"Fever"}',                            'postnatal', 2),
  ('warning_sign', 'wound',           '{"en":"Wound pain or pus"}',                'postnatal', 3),
  ('warning_sign', 'breast',          '{"en":"Breast pain / redness"}',            'postnatal', 4),
  ('warning_sign', 'pn_headache',     '{"en":"Severe headache or blurred vision"}','postnatal', 5),
  ('warning_sign', 'foul_discharge',  '{"en":"Bad-smelling vaginal discharge"}',   'postnatal', 6),
  ('warning_sign', 'low_mood',        '{"en":"Feeling very low"}',                 'postnatal', 7),
  ('warning_sign', 'not_feeding',     '{"en":"Not feeding"}',                      'baby', 1),
  ('warning_sign', 'baby_fits',       '{"en":"Fits"}',                             'baby', 2),
  ('warning_sign', 'fast_breathing',  '{"en":"Fast breathing"}',                   'baby', 3),
  ('warning_sign', 'chest_indrawing', '{"en":"Chest pulls in when breathing"}',    'baby', 4),
  ('warning_sign', 'cold',            '{"en":"Feels cold"}',                       'baby', 5),
  ('warning_sign', 'baby_fever',      '{"en":"Fever / feels hot"}',                'baby', 6),
  ('warning_sign', 'sleepy',          '{"en":"Very sleepy / hard to wake"}',       'baby', 7),
  ('warning_sign', 'yellow',          '{"en":"Yellow skin or eyes"}',              'baby', 8),
  ('warning_sign', 'cord',            '{"en":"Cord redness or pus"}',              'baby', 9),
  -- Complaints at a visit, as reported (COMPLAINTS); free text goes to encounters.complaints_note.
  ('complaint', 'headache',                '{"en":"Headache"}',                 null, 1),
  ('complaint', 'blurred_vision',          '{"en":"Blurred vision"}',           null, 2),
  ('complaint', 'swelling',                '{"en":"Swelling"}',                 null, 3),
  ('complaint', 'bleeding',                '{"en":"Bleeding"}',                 null, 4),
  ('complaint', 'leaking_fluid',           '{"en":"Leaking fluid"}',            null, 5),
  ('complaint', 'abdominal_pain',          '{"en":"Abdominal pain"}',           null, 6),
  ('complaint', 'fever',                   '{"en":"Fever"}',                    null, 7),
  ('complaint', 'burning_urine',           '{"en":"Burning urine"}',            null, 8),
  ('complaint', 'vomiting',                '{"en":"Vomiting"}',                 null, 9),
  ('complaint', 'breathlessness',          '{"en":"Breathlessness"}',           null, 10),
  ('complaint', 'reduced_fetal_movements', '{"en":"Reduced fetal movements"}',  null, 11),
  -- Counselling topics at a visit.
  ('counselling_topic', 'nutrition',           '{"en":"Nutrition"}',           null, 1),
  ('counselling_topic', 'warning_signs',       '{"en":"Warning signs"}',       null, 2),
  ('counselling_topic', 'birth_preparedness',  '{"en":"Birth preparedness"}',  null, 3),
  ('counselling_topic', 'breastfeeding',       '{"en":"Breastfeeding"}',       null, 4),
  ('counselling_topic', 'family_planning',     '{"en":"Family planning"}',     null, 5),
  -- ANC completeness components (shared/domain VISIT_COMPONENTS).
  ('anc_component', 'bp',              '{"en":"Blood pressure"}',          null, 1),
  ('anc_component', 'weight',          '{"en":"Weight"}',                  null, 2),
  ('anc_component', 'urine_albumin',   '{"en":"Urine albumin"}',           null, 3),
  ('anc_component', 'fundal_height',   '{"en":"Fundal height"}',           null, 4),
  ('anc_component', 'fhr',             '{"en":"Fetal heart rate"}',        null, 5),
  ('anc_component', 'fetal_movements', '{"en":"Fetal movements asked"}',   null, 6),
  ('anc_component', 'presentation',    '{"en":"Presentation documented"}', null, 7),
  ('anc_component', 'ifa',             '{"en":"IFA / calcium dispensed"}', null, 8),
  ('anc_component', 'counselling',     '{"en":"Counselling given"}',       null, 9),
  ('anc_component', 'next_visit',      '{"en":"Next visit scheduled"}',    null, 10),
  -- Delivery: documented complications and medicines given in labour.
  ('delivery_complication', 'pph',               '{"en":"PPH"}',               null, 1),
  ('delivery_complication', 'eclampsia',         '{"en":"Eclampsia"}',         null, 2),
  ('delivery_complication', 'retained_placenta', '{"en":"Retained placenta"}', null, 3),
  ('delivery_complication', 'perineal_tear',     '{"en":"Perineal tear"}',     null, 4),
  ('delivery_complication', 'other',             '{"en":"Other"}',             null, 5),
  ('labour_medicine', 'oxytocin',           '{"en":"Oxytocin"}',              null, 1),
  ('labour_medicine', 'mgso4',              '{"en":"MgSO4"}',                 null, 2),
  ('labour_medicine', 'antibiotics',        '{"en":"Antibiotics"}',           null, 3),
  ('labour_medicine', 'blood_transfusion',  '{"en":"Blood transfusion"}',     null, 4),
  ('labour_medicine', 'antenatal_steroids', '{"en":"Steroids (antenatal)"}',  null, 5),
  -- Outcomes (CALLBACK_OUTCOMES, MISSED_OUTCOMES).
  ('callback_outcome', 'advised_to_come',   '{"en":"Advised to come in"}', null, 1),
  ('callback_outcome', 'visit_scheduled',   '{"en":"Visit scheduled"}',    null, 2),
  ('callback_outcome', 'information_given', '{"en":"Information given"}',  null, 3),
  ('callback_outcome', 'unreachable',       '{"en":"Unreachable"}',        null, 4),
  ('callback_outcome', 'other',             '{"en":"Other"}',              null, 5),
  ('contact_outcome', 'will_come',           '{"en":"Will come"}',           null, 1),
  ('contact_outcome', 'rescheduled',         '{"en":"Rescheduled"}',         null, 2),
  ('contact_outcome', 'delivered_elsewhere', '{"en":"Delivered elsewhere"}', null, 3),
  ('contact_outcome', 'moved_away',          '{"en":"Moved away"}',          null, 4),
  ('contact_outcome', 'unreachable',         '{"en":"Unreachable"}',         null, 5),
  ('contact_outcome', 'declined',            '{"en":"Declined"}',            null, 6),
  -- Discharge checklist items (DISCHARGE_MOTHER / DISCHARGE_BABY), grouped by subject.
  ('discharge_item', 'vitals',      '{"en":"Vitals documented"}',                          'mother', 1),
  ('discharge_item', 'meds',        '{"en":"Medicines & instructions documented"}',        'mother', 2),
  ('discharge_item', 'warning',     '{"en":"Warning signs explained (in her language)"}',  'mother', 3),
  ('discharge_item', 'pn_visit',    '{"en":"Postnatal visits scheduled"}',                 'mother', 4),
  ('discharge_item', 'fp',          '{"en":"Family-planning counselling documented"}',     'mother', 5),
  ('discharge_item', 'bf',          '{"en":"Breastfeeding support given"}',                'mother', 6),
  ('discharge_item', 'feeding',     '{"en":"Feeding documented"}',                         'baby', 1),
  ('discharge_item', 'weight',      '{"en":"Discharge weight documented"}',                'baby', 2),
  ('discharge_item', 'birth_doses', '{"en":"Birth-dose vaccines documented"}',             'baby', 3),
  ('discharge_item', 'jaundice',    '{"en":"Jaundice assessment documented"}',             'baby', 4),
  ('discharge_item', 'nb_visit',    '{"en":"Newborn follow-up scheduled"}',                'baby', 5),
  ('discharge_item', 'education',   '{"en":"Parent education given"}',                     'baby', 6);

-- Tag catalogue (src/data/catalogue.ts TAGS).
insert into public.tag_catalogue (code, label, grp, applies_to, template) values
  ('prev_cs',         '{"en":"Previous caesarean"}',                   'Obstetric', 'pregnancy', null),
  ('multiple',        '{"en":"Multiple pregnancy"}',                   'Obstetric', 'pregnancy', null),
  ('prev_stillbirth', '{"en":"Previous stillbirth"}',                  'Obstetric', 'pregnancy', null),
  ('prev_preterm',    '{"en":"Previous preterm birth"}',               'Obstetric', 'pregnancy', null),
  ('prev_pph',        '{"en":"Previous PPH"}',                         'Obstetric', 'pregnancy', null),
  ('placental',       '{"en":"Placental condition"}',                  'Obstetric', 'pregnancy', null),
  ('rh_neg',          '{"en":"Rh-negative"}',                          'Obstetric', 'pregnancy', null),
  ('hypertensive',    '{"en":"Hypertensive disorder"}',                'Medical',   'pregnancy', 'hypertensive'),
  ('gdm',             '{"en":"Diabetes / GDM"}',                       'Medical',   'pregnancy', 'gdm'),
  ('anaemia',         '{"en":"Anaemia under treatment"}',              'Medical',   'pregnancy', null),
  ('heart',           '{"en":"Heart disease"}',                        'Medical',   'pregnancy', null),
  ('kidney',          '{"en":"Kidney disease"}',                       'Medical',   'pregnancy', null),
  ('thyroid',         '{"en":"Thyroid disorder"}',                     'Medical',   'pregnancy', null),
  ('epilepsy',        '{"en":"Epilepsy"}',                             'Medical',   'pregnancy', null),
  ('infection_nb',    '{"en":"Infection needing newborn follow-up"}',  'Medical',   'pregnancy', null),
  ('adolescent',      '{"en":"Adolescent pregnancy"}',                 'Social',    'pregnancy', null),
  ('amat',            '{"en":"Advanced maternal age"}',                'Social',    'pregnancy', null),
  ('support',         '{"en":"Social support needed"}',                'Social',    'pregnancy', null),
  ('lbw',             '{"en":"LBW follow-up"}',                        'Newborn',   'baby',      'lbw'),
  ('preterm_fu',      '{"en":"Preterm follow-up"}',                    'Newborn',   'baby',      null),
  ('jaundice_fu',     '{"en":"Jaundice follow-up"}',                   'Newborn',   'baby',      'jaundice'),
  ('feeding',         '{"en":"Feeding support"}',                      'Newborn',   'baby',      null),
  ('nicu',            '{"en":"NICU graduate"}',                        'Newborn',   'baby',      null);

-- Observation codes: what the visit, registration and newborn forms record (PRD F-13, F-20).
insert into public.observation_codes (code, label, applies_to, value_type, unit, min_possible, max_possible, allowed_values, loinc) values
  ('weight',          'Weight',                       'mother', 'numeric', 'kg',     20,  250, null, '29463-7'),
  ('height',          'Height',                       'mother', 'numeric', 'cm',    100,  220, null, '8302-2'),
  ('bp_sys',          'BP systolic',                  'mother', 'numeric', 'mm[Hg]', 40,  300, null, '8480-6'),
  ('bp_dia',          'BP diastolic',                 'mother', 'numeric', 'mm[Hg]', 20,  200, null, '8462-4'),
  ('pulse',           'Pulse',                        'mother', 'numeric', '/min',   20,  250, null, '8867-4'),
  ('temp',            'Temperature',                  'mother', 'numeric', 'Cel',    25,   45, null, '8310-5'),
  ('fundal_height',   'Fundal height',                'mother', 'numeric', 'cm',      5,   60, null, '11881-0'),
  ('fhr',             'Fetal heart rate',             'mother', 'numeric', '/min',   40,  260, null, '55283-6'),
  ('presentation',    'Presentation',                 'mother', 'coded',   null,   null, null, '{Cephalic,Breech,Transverse,Unsure}', null),
  ('fetal_movements', 'Fetal movements (as reported)','mother', 'coded',   null,   null, null, '{Normal,Reduced}', null),
  ('urine_albumin',   'Urine albumin',                'mother', 'coded',   null,   null, null, '{Nil,Trace,1+,2+,3+}', null),
  ('urine_sugar',     'Urine sugar',                  'mother', 'coded',   null,   null, null, '{Nil,Trace,1+,2+,3+}', null),
  ('oedema',          'Oedema',                       'mother', 'coded',   null,   null, null, '{None,Pedal,Generalised}', null),
  ('blood_group',     'Blood group & Rh',             'mother', 'coded',   null,   null, null, '{A+,A-,B+,B-,AB+,AB-,O+,O-}', '882-1'),
  ('nb_weight',       'Weight',                       'baby',   'numeric', 'g',     200, 20000, null, '29463-7'),
  ('nb_length',       'Length',                       'baby',   'numeric', 'cm',     20,  110, null, '8302-2'),
  ('nb_head_circ',    'Head circumference',           'baby',   'numeric', 'cm',     15,   60, null, '9843-4'),
  ('nb_temp',         'Temperature',                  'baby',   'numeric', 'Cel',    25,   45, null, '8310-5'),
  ('nb_resp_rate',    'Respiratory rate',             'baby',   'numeric', '/min',    5,  150, null, '9279-1'),
  ('nb_feeding',      'Feeding (as observed)',        'baby',   'coded',   null,   null, null, '{Breastfeeding,Formula,Mixed,Difficulty feeding}', null),
  ('nb_jaundice',     'Jaundice assessment (as recorded)', 'baby', 'coded', null,  null, null, '{None seen,Face,Chest,Abdomen,Palms/soles}', null);

-- Investigation catalogue (shared/domain/schedules.ts INVESTIGATIONS + newborn tests, PRD F-16).
insert into public.investigation_catalogue (code, label, applies_to, kind, result_type, default_unit, sensitive, loinc) values
  ('hb1',         'Haemoglobin (Hb)',           'mother', 'lab',  'numeric', 'g/dL',    false, '718-7'),
  ('bg',          'Blood group & Rh',           'mother', 'lab',  'text',    null,      false, '882-1'),
  ('urine',       'Urine routine',              'mother', 'lab',  'text',    null,      false, null),
  ('hiv',         'HIV',                        'mother', 'lab',  'text',    null,      true,  null),
  ('vdrl',        'Syphilis (VDRL/RPR)',        'mother', 'lab',  'text',    null,      true,  null),
  ('hbsag',       'HBsAg',                      'mother', 'lab',  'text',    null,      true,  null),
  ('rbs',         'Blood sugar (first visit)',  'mother', 'lab',  'numeric', 'mg/dL',   false, null),
  ('tsh',         'TSH',                        'mother', 'lab',  'numeric', 'm[IU]/L', false, null),
  ('dating',      'Dating scan',                'mother', 'scan', 'text',    null,      false, null),
  ('anomaly',     'Anomaly scan',               'mother', 'scan', 'text',    null,      false, null),
  ('ogtt',        'OGTT 75 g',                  'mother', 'lab',  'text',    null,      false, null),
  ('hb2',         'Repeat Hb',                  'mother', 'lab',  'numeric', 'g/dL',    false, '718-7'),
  ('ict',         'Indirect Coombs test',       'mother', 'lab',  'text',    null,      false, null),
  ('hb3',         'Repeat Hb (3rd trimester)',  'mother', 'lab',  'numeric', 'g/dL',    false, '718-7'),
  ('nb_bilirubin','Bilirubin',                  'baby',   'lab',  'numeric', 'mg/dL',   false, null),
  ('nb_glucose',  'Blood sugar',                'baby',   'lab',  'numeric', 'mg/dL',   false, null),
  ('nb_tsh',      'Newborn TSH screen',         'baby',   'lab',  'numeric', 'm[IU]/L', false, null);

-- Vaccines: India UIP 0–24 months (PRD §10.5) and maternal Td. Schedules are generated on the server from
-- this table. dose_number is the position in the antigen's series (OPV-0 is dose 1). JE is district-specific.
insert into public.vaccine_catalogue (code, label, grp, applies_to, age_days, dose_number, route) values
  ('bcg',    'BCG',                     'Birth',        'baby',   0,   1, 'ID'),
  ('opv0',   'OPV-0',                   'Birth',        'baby',   0,   1, 'Oral'),
  ('hepb0',  'Hepatitis B birth dose',  'Birth',        'baby',   0,   1, 'IM'),
  ('opv1',   'OPV-1',                   '6 weeks',      'baby',   42,  2, 'Oral'),
  ('penta1', 'Pentavalent-1',           '6 weeks',      'baby',   42,  1, 'IM'),
  ('rvv1',   'Rotavirus-1',             '6 weeks',      'baby',   42,  1, 'Oral'),
  ('fipv1',  'fIPV-1',                  '6 weeks',      'baby',   42,  1, 'ID'),
  ('pcv1',   'PCV-1',                   '6 weeks',      'baby',   42,  1, 'IM'),
  ('opv2',   'OPV-2',                   '10 weeks',     'baby',   70,  3, 'Oral'),
  ('penta2', 'Pentavalent-2',           '10 weeks',     'baby',   70,  2, 'IM'),
  ('rvv2',   'Rotavirus-2',             '10 weeks',     'baby',   70,  2, 'Oral'),
  ('opv3',   'OPV-3',                   '14 weeks',     'baby',   98,  4, 'Oral'),
  ('penta3', 'Pentavalent-3',           '14 weeks',     'baby',   98,  3, 'IM'),
  ('rvv3',   'Rotavirus-3',             '14 weeks',     'baby',   98,  3, 'Oral'),
  ('fipv2',  'fIPV-2',                  '14 weeks',     'baby',   98,  2, 'ID'),
  ('pcv2',   'PCV-2',                   '14 weeks',     'baby',   98,  2, 'IM'),
  ('mr1',    'MR-1',                    '9 months',     'baby',   270, 1, 'SC'),
  ('pcvb',   'PCV booster',             '9 months',     'baby',   270, 3, 'IM'),
  ('vita1',  'Vitamin A (1st)',         '9 months',     'baby',   270, 1, 'Oral'),
  ('mr2',    'MR-2',                    '16–24 months', 'baby',   487, 2, 'SC'),
  ('dptb1',  'DPT booster-1',           '16–24 months', 'baby',   487, 1, 'IM'),
  ('opvb',   'OPV booster',             '16–24 months', 'baby',   487, 5, 'Oral'),
  ('vita2',  'Vitamin A (2nd)',         '16–24 months', 'baby',   487, 2, 'Oral'),
  ('td1',    'Td-1',                    'Pregnancy',    'mother', null, 1, 'IM'),
  ('td2',    'Td-2',                    'Pregnancy',    'mother', null, 2, 'IM'),
  ('tdb',    'Td booster',              'Pregnancy',    'mother', null, 3, 'IM');

insert into public.app_settings (key, value) values
  ('demo_mode', 'true'),                         -- allows client timestamps (time travel) and reset_demo
  ('consent_notice_version', '"v1"');
