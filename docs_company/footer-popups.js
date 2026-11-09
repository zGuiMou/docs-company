(() => {
  const content = {
    terms: {
      title: 'Termos de Uso',
      body: `<p>Este site faz parte do universo de roleplay do Expresso Continental. As informações, empresas, licitações e contratos exibidos são fictícios e destinados exclusivamente à experiência dentro do servidor.</p><p>Ao utilizar a plataforma, você concorda em fornecer informações pertinentes ao roleplay, respeitar as regras do servidor e não utilizar os recursos para prejudicar outros participantes. A Docs. Company pode atualizar ou remover conteúdos e funcionalidades quando necessário.</p>`
    },
    cookies: {
      title: 'Cookies',
      body: `<p>Utilizamos apenas cookies técnicos necessários para o funcionamento do login com Discord e para manter sua sessão ativa. Não utilizamos cookies de publicidade ou rastreamento de terceiros.</p><p>Você pode encerrar sua sessão pelo botão “Sair” ou limpar os cookies do navegador a qualquer momento.</p>`
    },
    careers: {
      title: 'Trabalhe Conosco',
      body: `<p>Quer participar do processo seletivo da Docs. Company? Entre em contato abrindo um ticket no nosso Discord. A equipe analisará sua solicitação e informará as próximas etapas.</p><p><a href="https://discord.gg/qvFy6pyEU" target="_blank" rel="noopener noreferrer">Abrir Discord</a></p>`
    }
  };

  const style = document.createElement('style');
  style.textContent = `.footer-popup-trigger{padding:0;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer}.footer-popup-trigger:hover{color:#fff}.footer-popover{position:fixed;inset:0;z-index:100;display:none;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.72)}.footer-popover.show{display:flex}.footer-popover-card{width:min(560px,100%);max-height:calc(100vh - 48px);overflow:auto;padding:24px;border:1px solid rgba(255,255,255,.12);border-radius:18px;background:linear-gradient(180deg,#0c141b,#0a0d12);box-shadow:0 24px 80px rgba(0,0,0,.4);color:#f5f7fa}.footer-popover-head{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:16px}.footer-popover-head h2{margin:0;font-size:24px;letter-spacing:-.04em}.footer-popover-close{width:36px;height:36px;border:1px solid rgba(255,255,255,.13);border-radius:9px;background:transparent;color:#f5f7fa;font-size:22px;cursor:pointer}.footer-popover-content{color:#97a6b7;line-height:1.7}.footer-popover-content p{margin:0 0 14px}.footer-popover-content a{color:#84c4ff;font-weight:700}`;
  document.head.appendChild(style);

  const modal = document.createElement('div');
  modal.className = 'footer-popover';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-hidden', 'true');
  modal.innerHTML = `<div class="footer-popover-card"><div class="footer-popover-head"><h2 id="footerPopoverTitle"></h2><button class="footer-popover-close" type="button" aria-label="Fechar">×</button></div><div class="footer-popover-content" id="footerPopoverContent"></div></div>`;
  document.body.appendChild(modal);

  const close = () => { modal.classList.remove('show'); modal.setAttribute('aria-hidden', 'true'); };
  document.querySelectorAll('[data-footer-popup]').forEach(button => {
    button.addEventListener('click', () => {
      const item = content[button.dataset.footerPopup];
      if (!item) return;
      document.getElementById('footerPopoverTitle').textContent = item.title;
      document.getElementById('footerPopoverContent').innerHTML = item.body;
      modal.classList.add('show');
      modal.setAttribute('aria-hidden', 'false');
      modal.querySelector('.footer-popover-close').focus();
    });
  });
  modal.querySelector('.footer-popover-close').addEventListener('click', close);
  modal.addEventListener('click', event => { if (event.target === modal) close(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') close(); });
})();
