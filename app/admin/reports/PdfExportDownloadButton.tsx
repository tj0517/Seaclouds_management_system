'use client'

import { useState } from 'react'
import { getExportDownloadUrl } from '@/app/data/actions/pdf'
import { Button } from '@/components/ui/button'
import { Download, Loader2 } from 'lucide-react'

export default function PdfExportDownloadButton({ exportId }: { exportId: string }) {
    const [loading, setLoading] = useState(false)

    async function handleDownload() {
        setLoading(true)
        try {
            const result = await getExportDownloadUrl(exportId)
            if (result.url) {
                window.open(result.url, '_blank')
            }
        } finally {
            setLoading(false)
        }
    }

    return (
        <Button onClick={handleDownload} disabled={loading} variant="ghost" size="sm">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
        </Button>
    )
}
