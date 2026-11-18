import './FormSection.css'

/**
 * Visual wrapper for one logical group of the shipment form.
 */
function FormSection({ step, title, description, children }) {
  return (
    <section className="form-section">
      <header className="form-section__head">
        <span className="form-section__step" aria-hidden="true">
          {step}
        </span>
        <div>
          <h2 className="form-section__title">{title}</h2>
          {description && <p className="form-section__desc">{description}</p>}
        </div>
      </header>
      <div className="form-section__body">{children}</div>
    </section>
  )
}

export default FormSection