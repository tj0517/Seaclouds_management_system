'use client'

// DCS 1b.09 (PR 2): one file's Download control. A button, not a link: the
// signed URL is minted on click by the downloadFile action, as the signed-in
// user, lives sixty seconds, and is never rendered into the page. On success
// the action returns it and this button sends the browser there with
// window.location.assign — the URL answers with Content-Disposition:
// attachment, so the browser saves the file and the page stays. On refusal
// the action returns the one sentence (lib/files.ts,
// FILE_NOT_AVAILABLE_MESSAGE), shown in place.
//
// Not redirect() from the action (PR #81 review 5): the Next client router
// records an external action redirect as its canonical URL and expects the
// page to unload; a download does not unload it, and every later server
// action on the page was then POSTed to the storage URL. The plain
// location.assign here never touches the router, so the next Add File after a
// download posts to the app — e2e:files h/0 and h/2 prove it, and prove this
// button is enabled again once the action has returned.
//
// Who may read the bytes is the bucket's SELECT policy (holders of a DCS role
// on the project, and admins — O-16). A Timesheet-only member sees this row
// (dcs.files metadata) and gets the sentence when they press the button.
import { useState, useTransition } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { downloadFile } from '@/app/data/actions/files'

export default function DownloadFileButton({ fileId, fileName }: { fileId: string; fileName: string }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        data-download={fileName}
        onClick={() => {
          setError(null)
          start(async () => {
            const result = await downloadFile({ fileId })
            if (!result.ok) {
              setError(result.message ?? 'This file is not available to you.')
              return
            }
            window.location.assign(result.data.url)
          })
        }}
      >
        {pending ? <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> : <Download aria-hidden className="h-3.5 w-3.5" />}
        Download
      </Button>
      {error ? (
        <p role="alert" className="max-w-xs text-right text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  )
}
