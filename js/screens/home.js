// شاشة الرفيقة (الشخصية الطافية والمحادثة تأتي في المرحلتين ٢ و٣)
export const title = 'الرفيقة';

export function mount(root) {
  root.innerHTML = `
    <section class="placeholder">
      <div>
        <div class="placeholder__orb" aria-hidden="true"></div>
        <p>هنا ستطفو رفيقتك قريباً.</p>
        <p class="muted">ستتحدث معها صوتاً أو كتابة، وتحفظ كلامك وتصنّفه.</p>
      </div>
    </section>
  `;
}
