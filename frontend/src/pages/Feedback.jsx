import { useState } from 'react'
import { Link } from 'react-router-dom'

const SUBJECT_OPTIONS = [
  'Bug Report',
  'Feature Request',
  'Dataset Issue',
  'Analysis Question',
  'General Feedback',
  'Other',
]

export default function Feedback() {
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' })
  const [status, setStatus] = useState('idle') // idle | sending | success | error
  const [errorMsg, setErrorMsg] = useState('')

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setStatus('sending')
    setErrorMsg('')
    try {
      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/send-feedback`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(form),
        }
      )
      if (!res.ok) {
        let msg = `Request failed (${res.status})`
        try {
          const json = await res.json()
          if (json.error) msg = json.error
        } catch {
          // response wasn't JSON, keep default message
        }
        throw new Error(msg)
      }
      setStatus('success')
      setForm({ name: '', email: '', subject: '', message: '' })
    } catch (err) {
      setErrorMsg(err.message)
      setStatus('error')
    }
  }

  if (status === 'success') {
    return (
      <div className="max-w-5xl mx-auto py-12 px-4">
        <div className="max-w-lg mx-auto text-center py-16">
          <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-5">
            <svg className="w-7 h-7 text-green-600" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold mb-3">Thank you for your feedback!</h1>
          <p className="text-gray-600 mb-6">
            Your message has been sent successfully. We appreciate you taking the time to help improve ConfDB Board.
          </p>
          <div className="flex items-center justify-center gap-3">
            <button
              onClick={() => setStatus('idle')}
              className="px-4 py-2 text-sm font-medium rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer"
            >
              Send another
            </button>
            <Link
              to="/"
              className="px-4 py-2 text-sm font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700"
            >
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto py-12 px-4">
      <h1 className="text-2xl font-bold mb-2">Feedback</h1>
      <p className="text-gray-600 mb-8">
        Help us improve ConfDB Board. Whether you found a bug, have an idea for a new feature,
        or want to report an issue with a dataset, we'd love to hear from you.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        {/* Form — takes 2 columns on md+ */}
        <div className="md:col-span-2">
          {status === 'error' && (
            <div className="mb-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800 flex items-start gap-2">
              <svg className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
              <span>Failed to send feedback: {errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
                  Name <span className="text-red-400">*</span>
                </label>
                <input
                  id="name"
                  name="name"
                  type="text"
                  required
                  placeholder="Your name"
                  value={form.name}
                  onChange={handleChange}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
                  Email <span className="text-red-400">*</span>
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  placeholder="you@example.com"
                  value={form.email}
                  onChange={handleChange}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label htmlFor="subject" className="block text-sm font-medium text-gray-700 mb-1">
                Subject <span className="text-red-400">*</span>
              </label>
              <select
                id="subject"
                name="subject"
                required
                value={form.subject}
                onChange={handleChange}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
              >
                <option value="" disabled>Select a topic...</option>
                {SUBJECT_OPTIONS.map((opt) => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="message" className="block text-sm font-medium text-gray-700 mb-1">
                Message <span className="text-red-400">*</span>
              </label>
              <textarea
                id="message"
                name="message"
                required
                rows={6}
                placeholder="Describe your feedback in detail..."
                value={form.message}
                onChange={handleChange}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-vertical"
              />
            </div>

            <button
              type="submit"
              disabled={status === 'sending'}
              className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center gap-2"
            >
              {status === 'sending' ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Sending...
                </>
              ) : (
                'Send Feedback'
              )}
            </button>
          </form>
        </div>

        {/* Sidebar — takes 1 column on md+ */}
        <div className="space-y-5">
          <div className="border border-gray-200 rounded-lg p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">What kind of feedback?</h3>
            <ul className="space-y-2.5 text-sm text-gray-600">
              <li className="flex items-start gap-2">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-red-400 mt-1.5 flex-shrink-0" />
                <span><strong className="text-gray-800">Bug Report</strong> — Something isn't working as expected</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 flex-shrink-0" />
                <span><strong className="text-gray-800">Feature Request</strong> — An idea for improvement</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-400 mt-1.5 flex-shrink-0" />
                <span><strong className="text-gray-800">Dataset Issue</strong> — Missing data, incorrect tags, etc.</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-purple-400 mt-1.5 flex-shrink-0" />
                <span><strong className="text-gray-800">Analysis Question</strong> — Help with templates or results</span>
              </li>
            </ul>
          </div>

          <div className="border border-gray-200 rounded-lg p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Other ways to reach us</h3>
            <ul className="space-y-2 text-sm text-gray-600">
              <li>
                <a
                  href="https://github.com/tkdsym2/ConfDB-Board/issues"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  GitHub Issues
                </a>
                <span className="text-gray-400"> — for bugs and feature requests</span>
              </li>
              <li>
                <a
                  href="https://x.com/tkdsym2"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  X (@tkdsym2)
                </a>
                <span className="text-gray-400"> — quick questions</span>
              </li>
              <li>
                <a
                  href="mailto:kazuma.takada222@gmail.com"
                  className="text-blue-600 hover:underline"
                >
                  kazuma.takada222@gmail.com
                </a>
                <span className="text-gray-400"> — direct email</span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}
