-- ============================================================
-- Fix: el body_text de aviso_administrativo tenía muy poco texto fijo
-- para 2 variables — Meta lo rechaza con "demasiadas variables en
-- relación con su longitud". Se alarga el texto fijo sin sacar variables.
-- ============================================================

update templates
set body_text = 'Hola {{1}}, te escribimos desde el consultorio de la Dra. Lucía Chahin para contarte lo siguiente: {{2}}. Ante cualquier duda, respondé este mensaje.'
where name = 'aviso_administrativo'
  and body_text = 'Hola {{1}}, te avisamos: {{2}}.';
