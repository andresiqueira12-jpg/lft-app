# LFT — Lutando Fora do Tatame

App de treino físico (musculação e calistenia) para quem treina jiu-jitsu, feito a partir
do PDF e da planilha que você enviou: cadastro do praticante, progressão de faixa,
"Novo treino" (com proposta automática de exercícios), "Adicionar treino" manual e
"Conferir progresso" (semanal/mensal, com boneco de músculos treinados).

Roda 100% no navegador, funciona offline e guarda os dados **no próprio celular**
(não tem servidor, login nem sincronização entre aparelhos).

---

## 1. Testar agora mesmo (30 segundos, sem instalar nada)

Abra o arquivo **`LFT-testar-agora.html`** (enviado separado do zip) direto no navegador
do seu Android:

1. Transfira esse arquivo pro celular (WhatsApp pra você mesmo, Google Drive, e-mail, etc.).
2. Abra a notificação/arquivo e escolha **Chrome** pra abrir.
3. Pronto — o app inteiro funciona ali, offline, com seus dados salvos no aparelho.

Esse arquivo único é ótimo pra testar e mexer, mas não vira um "ícone instalado" de
verdade na tela inicial (isso exige os passos 2 ou 3 abaixo).

---

## 2. Instalar como app na tela inicial (PWA) — o caminho mais simples pra ter um ícone real

Pra o Chrome oferecer "Instalar app"/"Adicionar à tela inicial" com ícone, splash screen
e funcionamento 100% offline, o navegador exige que os arquivos estejam servidos por HTTPS
(não funciona só abrindo o arquivo local pra isso). O jeito mais rápido e gratuito:

1. Crie uma conta grátis no [GitHub](https://github.com) (se ainda não tiver).
2. Crie um repositório novo, público, e suba **todo o conteúdo do zip**
   (`index.html`, `styles.css`, `data.js`, `app.js`, `manifest.json`, `sw.js`, pasta `icons/`)
   direto na raiz do repositório.
3. Em **Settings → Pages**, ative o GitHub Pages apontando pra branch `main` / pasta raiz.
4. Em ~1 minuto o GitHub te dá um link tipo `https://seunome.github.io/lft/`.
5. Abra esse link no Chrome do Android → menu (⋮) → **"Instalar aplicativo"** (ou vai
   aparecer um banner sozinho). Isso cria um ícone de verdade na tela inicial, com splash
   screen e uso offline.

Qualquer outro serviço de hospedagem estática gratuita (Netlify, Vercel, Cloudflare Pages)
funciona do mesmo jeito — é só apontar pra essa pasta.

---

## 3. Gerar um `.apk` de verdade (instalável fora da Play Store, ou pra publicar)

Com o link do passo 2 em mãos, use o **[PWABuilder](https://www.pwabuilder.com)** (gratuito,
sem precisar programar):

1. Cole a URL do seu app (ex.: `https://seunome.github.io/lft/`) e clique em analisar.
2. Vá na aba **Android** → **Generate Package**.
3. Baixe o pacote gerado — vem um `.apk` que você pode instalar direto no celular
   (ativando "Instalar de fontes desconhecidas" no Android) ou um `.aab` pra publicar na
   Play Store.

*Obs.: eu não tenho como compilar esse `.apk` aqui dentro da conversa — não tenho o SDK
do Android nem acesso à internet neste ambiente. Os passos acima resolvem isso do lado de
fora, em poucos minutos e sem custo.*

---

## O que foi implementado (mapeado nas telas do seu PDF)

- **Tela 00** — Cadastro (apelido, nascimento, peso, tempo de jiu-jitsu, faixa, graus) e
  a barra "faixa atual → próxima" no topo de toda tela (menos a 00), com o texto
  "RUMO À FAIXA X". A lista de faixas mostra só o nome da cor (Branca, Azul, Roxa...).
- **Menu principal** — Adicionar treino / Novo treino / Conferir progresso / Alterar
  dados / Sair.
- **Adicionar treino (01 / 01.1)** — busca no banco de exercícios com autocomplete;
  se não existir, cadastra um novo (classe, nome, músculos).
- **Novo treino (02 → 02.4)** — escolhe musculação/calistenia → tempo → habilidade a
  melhorar (com botão "i" mostrando a importância no jiu-jitsu) → lista de exercícios
  proposta automaticamente → execução com cronômetro de séries/descanso, avançando
  sozinho pro próximo exercício. Tocar no cronômetro durante a contagem (descanso ou
  exercício por tempo) encerra a contagem na hora e já considera aquela série/exercício
  como executada, avançando direto pro próximo.
- **"Propor treino para hoje"** — olha os últimos 15 dias e prioriza a habilidade (e,
  em caso de empate, os músculos) menos trabalhados; sorteia quando não há histórico.
- **Conferir progresso (03 / 03.1 / 03.2)** — calendário semanal e mensal navegável,
  boneco frente/verso colorindo os músculos treinados (escala de vermelho) e contagem
  de dias por habilidade no mês.

## Decisões que tomei em pontos que o material deixava em aberto

- **"+1 hora"** foi tratado como ~90 min de orçamento de tempo pra montar o treino.
- Na tela **Adicionar treino**, o mockup só tinha "Voltar" — acrescentei um botão
  **"Salvar exercício"**, pra dar pra registrar vários exercícios do mesmo treino antes
  de sair.
- A aba **"Músculos"** da planilha estava em branco, então eu mesmo agrupei os ~114 termos
  usados na coluna "músculos trabalhados" em 16 regiões do corpo, pra desenhar o boneco
  frente/verso do progresso.
- Faixa **infantil vs. adulta**: calculada automaticamente pela data de nascimento (até
  16 anos = escala infantil, acima = adulta), seguindo a planilha.
- Exercício "de tempo" pra preencher o treino (ex.: corrida, jumping jack no lugar de
  polichinelo): uso o próprio grupo "Condicionamento cardiovascular/Gás" da planilha
  como fonte, igual ao exemplo do PDF.

## Sobre os dados

Tudo (cadastro, histórico de treinos, exercícios que você adicionar) fica salvo só
nesse navegador/aparelho. Limpar os dados do Chrome ou desinstalar o app apaga o
progresso — não existe backup na nuvem nessa versão.
