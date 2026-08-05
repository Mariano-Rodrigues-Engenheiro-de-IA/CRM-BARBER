# Mudanças na Interface WhatsApp - CRM Barber

## Resumo Executivo

Foram realizadas duas transformações principais na interface do CRM dentro do WhatsApp Web:

1. **Redesign de Cores**: Paleta escura/pesada → Paleta clara com verde WhatsApp
2. **Comportamento do Popup**: Drawer fixo na esquerda → Popover dinâmico abaixo da aba

---

## 1. Mudanças de Cores

### Arquivo: `extension/content.css` (Linhas 6-29)

#### Antes (Paleta Escura):
```css
--z-ink: #0e1a15;           /* trilho lateral muito escuro */
--z-bar: #12211b;           /* barra do topo escura */
--z-surface: #16281f;       /* superfícies escuras */
--z-accent: #2ecc8f;        /* verde escuro */
--z-text: #e7f2ec;          /* texto claro */
```

#### Depois (Paleta Clara):
```css
--z-ink: #f5f5f5;           /* trilho lateral cinza muito claro */
--z-bar: #ffffff;           /* barra do topo branca */
--z-surface: #f0f0f0;       /* superfícies cinza claro */
--z-accent: #25d366;        /* verde WhatsApp oficial */
--z-text: #1a1a1a;          /* texto escuro */
```

### Impacto Visual:
- ✅ Trilho lateral esquerdo: agora cinza claro em vez de preto
- ✅ Barra superior de abas: agora branca em vez de verde-escuro
- ✅ Botões e pílulas: cinza com verde WhatsApp em vez de verde-escuro
- ✅ Texto: escuro e legível em vez de claro
- ✅ Identidade visual: leve, moderna e alinhada com WhatsApp oficial

---

## 2. Comportamento do Popup de Contatos

### Arquivo: `extension/content-v15.js`

#### Mudanças Principais:

**A. Adicionada variável para rastrear a aba clicada:**
```javascript
let drawerAnchor = null; // Elemento que acionou o drawer
```

**B. Refatorada função `openDrawer(anchor)`:**
- Agora aceita o elemento da aba como parâmetro
- Armazena a referência para posicionamento dinâmico

**C. Nova função `positionDrawer()`:**
```javascript
function positionDrawer() {
  // Encontra a aba ativa
  // Posiciona o popover abaixo dela
  // Ajusta automaticamente se sair da tela (horizontal/vertical)
}
```

**D. Atualizadas funções de filtro:**
- `filterByLabel()`: encontra a pílula clicada e passa como âncora
- `filterByStage()`: encontra a etapa clicada e passa como âncora

### Arquivo: `extension/content.css` (Linhas 401-418)

#### Antes (Drawer Fixo):
```css
#crm-drawer {
  position: fixed;
  top: 40px;
  left: 46px;
  bottom: 0;
  width: 340px;
  box-shadow: 18px 0 40px rgba(0, 0, 0, 0.28);
}
```

#### Depois (Popover Dinâmico):
```css
#crm-drawer {
  position: fixed;
  z-index: 999999;
  display: flex;
  flex-direction: column;
  background: var(--z-bar);
  border: 1px solid var(--z-line);
  border-radius: 12px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
  width: 420px;
  max-height: 600px;
  /* Posicionamento definido via JavaScript */
}
```

### Impacto Funcional:
- ✅ Popup abre **exatamente abaixo da aba clicada**
- ✅ Centralizado horizontalmente em relação à aba
- ✅ Design moderno com bordas arredondadas
- ✅ Ajusta automaticamente se sair da tela
- ✅ Sombra suave em vez de pesada
- ✅ Melhor experiência visual e usabilidade

---

## 3. Detalhes Técnicos da Função de Posicionamento

```javascript
function positionDrawer() {
  // 1. Encontra a aba ativa (com classe crm-pill-on)
  let anchor = drawerAnchor || document.querySelector(".crm-pill-on");
  
  // 2. Calcula posição abaixo da aba
  const rect = anchor.getBoundingClientRect();
  let top = rect.bottom + 10;  // 10px de espaço
  let left = rect.left + (rect.width - 420) / 2;  // centralizado
  
  // 3. Ajusta se sair da tela (horizontal)
  if (left < 8) left = 8;
  if (left + 420 > viewportWidth - 8) left = viewportWidth - 420 - 8;
  
  // 4. Ajusta se sair da tela (vertical)
  if (top + height > viewportHeight - 8) {
    top = rect.top - height - 10;  // abre acima
  }
  
  // 5. Aplica estilos
  drawerRef.style.top = `${top}px`;
  drawerRef.style.left = `${left}px`;
}
```

---

## 4. Checklist de Mudanças

- [x] Atualizar paleta de cores CSS
- [x] Trocar verde escuro por verde WhatsApp (#25d366)
- [x] Trocar preto por cinza claro (#f5f5f5)
- [x] Trocar texto claro por texto escuro
- [x] Refatorar drawer para popover
- [x] Implementar posicionamento dinâmico
- [x] Adicionar ajustes automáticos de viewport
- [x] Manter funcionalidade de busca e filtro
- [x] Preservar design moderno com bordas arredondadas

---

## 5. Como Testar

1. **Cores**: Abra o WhatsApp Web com a extensão ativa
   - Verifique o trilho lateral esquerdo (deve ser cinza claro)
   - Verifique a barra superior de abas (deve ser branca)
   - Clique em qualquer aba para ver o verde WhatsApp

2. **Popup**: Clique em qualquer lista ou etapa
   - O popup deve abrir **abaixo da aba clicada**
   - Deve estar **centralizado horizontalmente**
   - Se clicar perto da borda, deve se ajustar automaticamente
   - Se clicar perto do rodapé, deve abrir **acima** da aba

---

## 6. Arquivos Modificados

- `extension/content.css` - Paleta de cores e estilos do drawer
- `extension/content-v15.js` - Lógica de posicionamento do popover

---

## Notas Importantes

- A funcionalidade de filtro nativo do WhatsApp foi preservada
- A busca de contatos continua funcionando normalmente
- O design é responsivo e se adapta a diferentes tamanhos de tela
- A paleta de cores é consistente em toda a interface (rail, topbar, pills, modais)

