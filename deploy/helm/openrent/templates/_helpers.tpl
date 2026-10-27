{{- define "openrent.fullname" -}}
{{- if contains .Chart.Name .Release.Name }}{{ .Release.Name | trunc 63 | trimSuffix "-" }}{{ else }}{{ printf "%s-%s" .Release.Name .Chart.Name | trunc 63 | trimSuffix "-" }}{{ end }}
{{- end }}

{{- define "openrent.labels" -}}
app.kubernetes.io/name: {{ .Chart.Name }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end }}

{{- define "openrent.selector" -}}
app.kubernetes.io/name: {{ .root.Chart.Name }}
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end }}

{{- define "openrent.image" -}}
{{ .root.Values.image.registry }}/{{ .name }}:{{ .root.Values.image.tag | default .root.Chart.AppVersion }}
{{- end }}

{{- define "openrent.secretName" -}}
{{ .Values.secrets.existingSecret | default (printf "%s-secrets" (include "openrent.fullname" .)) }}
{{- end }}

{{/* Environment shared by the API, the worker and the migration Job. */}}
{{- define "openrent.env" -}}
- name: OPENRENT_PUBLIC_URL
  value: {{ .Values.publicUrl | quote }}
- name: ADMIN_URL
  value: {{ printf "%s/admin" (trimSuffix "/" .Values.publicUrl) | quote }}
- name: STOREFRONT_URL
  value: {{ .Values.publicUrl | quote }}
- name: OPENRENT_MODE
  value: {{ .Values.mode | quote }}
- name: OPENRENT_STOREFRONT_DOMAIN
  value: {{ .Values.storefrontDomain | quote }}
- name: LOG_LEVEL
  value: {{ .Values.logLevel | quote }}
- name: DATABASE_POOL_MAX
  value: {{ .Values.database.poolMax | quote }}
- name: S3_ENDPOINT
  value: {{ .Values.s3.endpoint | quote }}
- name: S3_REGION
  value: {{ .Values.s3.region | quote }}
- name: S3_BUCKET
  value: {{ .Values.s3.bucket | quote }}
- name: EMAIL_FROM
  value: {{ .Values.email.from | quote }}
- name: STRIPE_PUBLISHABLE_KEY
  value: {{ .Values.stripe.publishableKey | quote }}
{{- range $k, $v := .Values.extraEnv }}
- name: {{ $k }}
  value: {{ $v | quote }}
{{- end }}
{{- $secret := include "openrent.secretName" . }}
{{- range $key := list "OPENRENT_ENCRYPTION_KEY" "OPENRENT_SESSION_SECRET" "DATABASE_URL" }}
- name: {{ $key }}
  valueFrom: { secretKeyRef: { name: {{ $secret }}, key: {{ $key }} } }
{{- end }}
{{- range $key := list "DATABASE_MIGRATION_URL" "S3_ACCESS_KEY" "S3_SECRET_KEY" "SMTP_URL" "STRIPE_SECRET_KEY" "STRIPE_WEBHOOK_SECRET" }}
- name: {{ $key }}
  valueFrom: { secretKeyRef: { name: {{ $secret }}, key: {{ $key }}, optional: true } }
{{- end }}
{{- end }}
