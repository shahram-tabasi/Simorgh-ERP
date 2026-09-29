import { LoginForm } from './LoginForm';

export default function LoginPage() {
  return (
    <main className="center">
      <section className="card">
        <h1>سیمرغ ERP</h1>
        <p className="muted">برای مدیران سیمرغ، کد شرکت را خالی بگذارید.</p>
        <LoginForm />
      </section>
    </main>
  );
}
