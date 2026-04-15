-- Agrega columna barrio a la tabla perfiles.
-- El campo ya existe en los formularios (cuenta.html y checkout.html) pero no se persistía.
ALTER TABLE perfiles ADD COLUMN IF NOT EXISTS barrio text;
