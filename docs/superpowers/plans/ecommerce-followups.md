# E-commerce: pendentes do plano 1

Lista de itens adiados nas revisões do plano 1 (Base e Produtos), a considerar nos planos seguintes.

## Obrigatórios em planos futuros
- **Plano 3 (Encomendas): stock negativo.** O servidor rejeita `stock < 0`. As encomendas vão descontar stock com incrementos relativos, por isso o plano 3 tem de aceitar o stock negativo que já exista ao gravar um produto e deixar de escrever o `stock` absoluto a partir do formulário (senão há uma corrida com os descontos das encomendas). Uma variante que aparece em encomendas deve ser desativada, nunca apagada.
- **Plano 6 (Storefront): slug regenerado ao renomear.** O slug é gerado de novo sempre que o nome muda, o que altera os URLs públicos. Antes de lançar o storefront é preciso decidir entre slugs estáveis e redirecionamentos.
- **Plano 3: precisão decimal** de `weight`, `width`, `height` e `depth`. Confirmar antes de calcular portes.

## Menores (adiados)
- Task 1: minor (deferred): checkModuleIsActive substring match '/ecommerce' could catch future URLs containing '/ecommerce' — prefer segment match
- Task 1: minor (deferred): registerTrads branching untested (only mergeTranslations)
- Task 2: minor (deferred): contentTypes test doesn't assert min/max/required/types
- Task 2: minor (deferred): no unique (variant,locale)/(product,locale) index on translation tables — service must upsert per locale
- Task 3: minor (deferred): (strapi as any) in permissions.ts; registration not try/catch (boot fails loudly); test doesn't tie computed ids to constants
- Task 4: minor (deferred): integer-only rule for price/stock undocumented; tests miss blank sku / string price / 3rd dup
- Task 5: minor (deferred): orphaned provider file if DB create fails after upload — add cleanup
- Task 5: minor (deferred): stream-only providers lacking upload() unsupported
- Task 5: minor (deferred): no owner guard in service (controller Task 7 enforces productId|variantId)
- Task 5: minor (deferred): position max+1 not atomic; remove() uses current provider not record.provider
- Task 6: minor (deferred, SHOULD FIX in final wave): blanked non-default translation (name/option) isn't deleted — edit appears ignored
- Task 6: minor (deferred, SHOULD FIX in final wave): image files removed inside the transaction before commit — collect and delete after commit
- Task 6: minor (deferred): SKU/NotFound pre-checks outside transaction (race, admin-only)
- Task 6: minor (deferred): slug regenerated on rename (per brief)
- Task 6: minor (deferred): tests written after code (no RED)
- Task 7: minor (deferred): non-numeric :id → NaN to service; productId/variantId exclusivity & NaN; repeated 'file' field array bypasses size check; missing tests (INVALID_IMAGE, invalid transform JSON, upload 201, unknown locale)
- Task 7: minor (deferred): npm run build fails on pre-existing admin error SlugInput.tsx:317 — check before release
- Task 8: minor (deferred): TranslateOutput.failed any / pagination loose types; style slips; no gateway/SaveProduct tests; no RED
- Task 9: minor (deferred): illustration aria-labels hardcoded English; redundant enable buttons when disabled
- Fix: minor (deferred): noStrapiUtilsImport test only matches single-quoted forms
- Task 10: minor (deferred): Table colCount 5 vs 6 columns; Enter submits search form; whitespace search not trimmed; stale rows on error; any-typed onChange; pageWindow untested
- Task 11: minor (deferred, SHOULD FIX in final wave): AI results keyed by variant index while Add/Remove enabled during translate — disable variant edits while translating
- Task 11: minor (deferred): option error hidden in modal when on other locale; failed reload after save replaces editor; no locale-tab error markers; no component tests; ProductEditPage 444 lines
- Task 12: minor (deferred): upload/delete catch blocks drop error (no log); changeHeight uses lockedHeight(next,1/ratio) oddly; Link icon for lock

## Plano 2 (Configurações): pendentes
- **'= {{' em texto:** a regra rejeita também texto normal como 'Total = {{order.total}}' (falso positivo). Restringir a verificação ao interior das tags.
- **Valores sem aspas a começar por texto literal** (`href=https://x/{{a}}`) não são apanhados. O escape de `=`, aspas e backtick limita o impacto.
- **Segredo opcional ilegível:** não pode ser limpo pela UI (o servidor permite).
- **Mensagens de sucesso do teste de ligação** ('Restricted key', 'Key valid (sending access only)') vêm do servidor em inglês e não são traduzidas.
- Task 1: minor (deferred, SHOULD FIX in final wave): decipher without authTagLength 16 / tag length check — add {authTagLength:16} + truncated-tag test
- Task 1: minor (deferred): no tests for v!==1/malformed shape; no RED
- Task 2: minor (deferred): required flags not asserted; displayName 'Ecommerce' vs 'E-commerce'; no RED
- Task 3: minor (deferred): UNREACHABLE for any unexpected status; __resetRegistryForTests in prod code; no RED
- Task 4: minor (deferred): concurrent activations may leave two billing active (no lock); settings.ts ~600 lines (extract validators); exclusivity per category
- Task 5: minor (deferred, SHOULD FIX in final wave): unsafe-HTML false positives (';on…=' in URLs, whitespace-stripped 'Java Script:'); escape '=' and '`' / reject unquoted ={{…}} attribute interpolation
- Task 5: minor (deferred): recursion depth cap; bounded meta regex; duplicate issues under invalid #each
- Task 6: minor (deferred, SHOULD FIX in final wave): fromName not quoted in Resend 'from' (comma/angle brackets)
- Task 6: minor (deferred): concurrent template saves may duplicate snapshot version numbers; 'store credit' vs 'commercial credit' wording
- Task 7: minor (deferred): validation coverage tests for preview/versions/restore routes; NaN ids → integer check; misleading route-order comment; no RED
- Task 8: minor (deferred): duplicate toast + inline errors; unknown details.code falls to raw id; encryption flag via integrations list; country picker no search
- Task 9: minor (deferred): unknown test code shows raw i18n id; delete confirm doesn't name method; switch label shows 'Active' even when off (browser)
- Task 10: minor (deferred, SHOULD FIX in final wave): no unsaved-changes guard on back/route leave/tab close in template editor (useBlocker + beforeunload)
- Task 10: minor (deferred): stale preview on locale switch (bump counter); test email sends saved version (warn if dirty)
