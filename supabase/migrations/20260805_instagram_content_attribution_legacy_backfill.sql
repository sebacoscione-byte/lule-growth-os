-- Conserva los códigos de sede que históricamente se guardaban en leads.utm_content antes de que
-- esa columna quedara reservada para el identificador de pieza.

update leads
set referral_code = upper(trim(utm_content))
where referral_code is null
  and utm_content ~* '^[a-z]{2,4}-[a-z]{2,4}-[0-9]{2}$';
