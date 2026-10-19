-- The example reward «Худи деска» (0212 seed) asks for discipline level 3, which is «Железный» (levels: 0 Старт,
-- 1 Собранный, 2 Стабильный, 3 Железный, 4 Эталон) — its description said «Стабильный». Only the untouched seed row is
-- fixed; an item the owner already edited keeps the owner's words.
UPDATE reward_items
   SET description = 'Уровень «Железный» по очкам дисциплины.', updated_at = now()
 WHERE created_by = 'system' AND title = 'Худи деска' AND condition_kind = 'level' AND condition_ref = '3'
   AND description = 'Уровень «Стабильный» по очкам дисциплины.';
