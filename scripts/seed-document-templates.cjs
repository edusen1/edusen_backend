#!/usr/bin/env node

/**
 * Seed des DocumentTemplate système (templates par défaut).
 * Ces templates sont les designs "Classique" — le HTML actuel hardcodé dans les services.
 * Ils servent de base pour la personnalisation par les écoles.
 *
 * Usage: node scripts/seed-document-templates.cjs
 */

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const envPath = path.resolve(__dirname, '..', '.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]] !== undefined) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
}

const prisma = new PrismaClient();

const DEFAULT_STYLES = {
  primaryColor: '#2563eb',
  secondaryColor: '#64748b',
  fontFamily: 'Arial, sans-serif',
  logoPosition: 'left',
  logoSize: 60,
  showDevise: false,
  deviseText: '',
  showCachet: true,
  headerText: '',
  footerText: '',
  watermark: false,
};

// ── Bulletin template ────────────────────────────────────────────────────────
// Le HTML utilise le système de placeholders {{variable}} du TemplateRendererService.
// Pour le moment, le service bulletin-document.service.ts utilise son propre rendu.
// Ce template sert de base pour les futures personnalisations.

const BULLETIN_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: {{style.fontFamily}}; font-size: 11px; color: #1e293b; }
  .header { display: flex; align-items: center; gap: 16px; padding: 16px; border-bottom: 2px solid {{style.primaryColor}}; }
  .logo { width: {{style.logoSize}}px; height: {{style.logoSize}}px; }
  .school-name { font-size: 18px; font-weight: 800; color: {{style.primaryColor}}; }
  .student-info { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 12px 16px; background: #f8fafc; border-bottom: 1px solid #e2e8f0; }
  .info-label { color: #64748b; font-size: 10px; text-transform: uppercase; }
  .info-value { font-weight: 600; color: #0f172a; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th { background: {{style.primaryColor}}; color: white; padding: 6px 8px; font-size: 10px; text-transform: uppercase; text-align: center; }
  th:first-child { text-align: left; }
  td { padding: 5px 8px; border-bottom: 1px solid #e2e8f0; font-size: 11px; }
  .footer { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; padding: 12px 16px; border-top: 2px solid {{style.primaryColor}}; background: #f8fafc; margin-top: 8px; }
  .footer-label { font-size: 9px; color: #64748b; text-transform: uppercase; }
  .footer-value { font-size: 16px; font-weight: 800; }
  .appreciation { padding: 8px 16px; font-style: italic; color: #475569; border-top: 1px solid #e2e8f0; }
  {{#if style.showDevise}}.devise { text-align: center; font-size: 10px; color: #94a3b8; margin-bottom: 4px; }{{/if}}
</style>
</head>
<body>
{{#if style.showDevise}}<div class="devise">{{style.deviseText}}</div>{{/if}}
<div class="header">
  {{#if school.logoUrl}}<img class="logo" src="{{school.logoUrl}}" />{{/if}}
  <div>
    <div class="school-name">{{school.name}}</div>
    <div style="font-size:10px;color:#64748b">{{school.address}} — {{school.phone}}</div>
  </div>
  <div style="margin-left:auto;text-align:right">
    <div style="font-size:14px;font-weight:700;color:{{style.primaryColor}}">BULLETIN {{bulletin.period}}</div>
    <div style="font-size:10px;color:#64748b">{{bulletin.year}}</div>
  </div>
</div>

<div class="student-info">
  <div><span class="info-label">Eleve</span><br/><span class="info-value">{{student.name}}</span></div>
  <div><span class="info-label">Matricule</span><br/><span class="info-value">{{student.matricule}}</span></div>
  <div><span class="info-label">Classe</span><br/><span class="info-value">{{student.classe}}</span></div>
  <div><span class="info-label">Ne(e) le</span><br/><span class="info-value">{{student.birthDate}} a {{student.birthPlace}}</span></div>
</div>

<table>
  <thead>
    <tr>
      <th>Disciplines</th>
      <th>Devoirs</th>
      <th>Composition</th>
      <th>Moyenne</th>
      <th>Coef.</th>
      <th>Total</th>
      <th>Appreciation</th>
    </tr>
  </thead>
  <tbody>
    {{#each rows}}
    <tr>
      <td style="font-weight:600">{{label}}</td>
      <td style="text-align:center">{{moyDevoirs}}</td>
      <td style="text-align:center">{{composition}}</td>
      <td style="text-align:center;font-weight:700">{{moyenne}}</td>
      <td style="text-align:center">{{coefficient}}</td>
      <td style="text-align:center;font-weight:700">{{total}}</td>
      <td>{{appreciation}}</td>
    </tr>
    {{/each}}
  </tbody>
</table>

<div class="footer">
  <div><span class="footer-label">Moyenne generale</span><br/><span class="footer-value">{{bulletin.average}}</span></div>
  <div><span class="footer-label">Rang</span><br/><span class="footer-value">{{bulletin.rank}} / {{bulletin.totalStudents}}</span></div>
  <div><span class="footer-label">Absences / Retards</span><br/><span class="footer-value">{{bulletin.absences}} / {{bulletin.tardies}}</span></div>
</div>

{{#if bulletin.appreciation}}<div class="appreciation"><strong>Appreciation :</strong> {{bulletin.appreciation}}</div>{{/if}}

{{#if style.showCachet}}
<div style="text-align:right;padding:16px">
  {{#if style.cachetUrl}}<img src="{{style.cachetUrl}}" style="height:60px" />{{/if}}
  <div style="font-size:10px;color:#64748b">Le Directeur</div>
</div>
{{/if}}

{{#if style.footerText}}<div style="text-align:center;padding:8px;font-size:9px;color:#94a3b8">{{style.footerText}}</div>{{/if}}
</body>
</html>`;

// ── Carte scolaire template ──────────────────────────────────────────────────

const CARTE_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: {{style.fontFamily}}; width: 540px; height: 340px; position: relative; }
  .card { width: 100%; height: 100%; background: linear-gradient(135deg, #fff 0%, #f8fafc 100%); border: 2px solid {{style.primaryColor}}; display: flex; flex-direction: column; }
  .card-header { background: {{style.primaryColor}}; color: white; padding: 8px 16px; display: flex; align-items: center; gap: 10px; }
  .card-header .logo { width: 36px; height: 36px; border-radius: 50%; }
  .card-header .school { font-size: 14px; font-weight: 700; }
  .card-header .sub { font-size: 9px; opacity: 0.8; }
  .card-header .title { margin-left: auto; font-size: 11px; font-weight: 700; letter-spacing: 1px; }
  .card-body { display: flex; flex: 1; padding: 12px 16px; gap: 16px; }
  .photo { width: 90px; height: 110px; background: #e2e8f0; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .photo img { width: 100%; height: 100%; object-fit: cover; }
  .info { flex: 1; display: flex; flex-direction: column; gap: 4px; }
  .info-row { display: flex; gap: 6px; font-size: 10px; }
  .info-row .label { color: #94a3b8; min-width: 70px; }
  .info-row .value { color: #0f172a; font-weight: 600; }
  .name { font-size: 16px; font-weight: 800; color: #0f172a; margin-bottom: 4px; }
  .qr { position: absolute; bottom: 12px; right: 16px; width: 60px; height: 60px; }
  .card-footer { background: #f8fafc; border-top: 1px solid #e2e8f0; padding: 6px 16px; font-size: 9px; color: #64748b; display: flex; justify-content: space-between; }
</style>
</head>
<body>
<div class="card">
  <div class="card-header">
    {{#if school.logoUrl}}<img class="logo" src="{{school.logoUrl}}" />{{/if}}
    <div>
      <div class="school">{{school.name}}</div>
      <div class="sub">{{school.sub}}</div>
    </div>
    <div class="title">{{card.title}}</div>
  </div>
  <div class="card-body">
    <div class="photo">
      {{#if user.photoUrl}}<img src="{{user.photoUrl}}" />{{/if}}
    </div>
    <div class="info">
      <div class="name">{{user.name}}</div>
      <div class="info-row"><span class="label">Matricule</span><span class="value">{{user.matricule}}</span></div>
      <div class="info-row"><span class="label">Classe</span><span class="value">{{user.classe}}</span></div>
      <div class="info-row"><span class="label">Ne(e) le</span><span class="value">{{user.dateNaissance}}</span></div>
      <div class="info-row"><span class="label">Lieu</span><span class="value">{{user.lieuNaissance}}</span></div>
      {{#if parent.nom}}<div class="info-row"><span class="label">Parent</span><span class="value">{{parent.nom}} — {{parent.telephone}}</span></div>{{/if}}
    </div>
  </div>
  <div class="card-footer">
    <span>{{school.annee}}</span>
    <span>Valide jusqu'au {{school.validUntil}}</span>
  </div>
  {{#if card.qrDataUrl}}<img class="qr" src="{{card.qrDataUrl}}" />{{/if}}
</div>
</body>
</html>`;

// ── Reçu de paiement template ────────────────────────────────────────────────

const RECU_HTML = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: {{style.fontFamily}}; font-size: 12px; color: #1e293b; padding: 24px; }
  .header { display: flex; align-items: center; gap: 16px; padding-bottom: 16px; border-bottom: 2px solid {{style.primaryColor}}; margin-bottom: 16px; }
  .logo { width: 50px; height: 50px; }
  .school-name { font-size: 16px; font-weight: 800; color: {{style.primaryColor}}; }
  .ref { margin-left: auto; text-align: right; }
  .ref-label { font-size: 10px; color: #64748b; text-transform: uppercase; }
  .ref-value { font-size: 14px; font-weight: 700; color: #0f172a; }
  .title { text-align: center; font-size: 18px; font-weight: 800; color: {{style.primaryColor}}; margin-bottom: 16px; text-transform: uppercase; letter-spacing: 2px; }
  .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 16px; }
  .info-item { padding: 8px 12px; background: #f8fafc; border: 1px solid #e2e8f0; }
  .info-item .label { font-size: 9px; color: #64748b; text-transform: uppercase; }
  .info-item .value { font-size: 13px; font-weight: 600; color: #0f172a; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
  th { background: #f8fafc; padding: 8px 12px; font-size: 10px; text-transform: uppercase; color: #64748b; text-align: left; border-bottom: 1px solid #e2e8f0; }
  td { padding: 8px 12px; border-bottom: 1px solid #f1f5f9; }
  .total-row td { font-weight: 700; border-top: 2px solid #0f172a; font-size: 14px; }
  .badge { display: inline-block; padding: 4px 12px; font-size: 11px; font-weight: 700; text-transform: uppercase; }
  .badge-green { background: #dcfce7; color: #16a34a; }
  .badge-yellow { background: #fef3c7; color: #d97706; }
  .footer { text-align: center; margin-top: 24px; padding-top: 12px; border-top: 1px solid #e2e8f0; font-size: 10px; color: #94a3b8; }
</style>
</head>
<body>
<div class="header">
  {{#if school.logoUrl}}<img class="logo" src="{{school.logoUrl}}" />{{/if}}
  <div>
    <div class="school-name">{{school.name}}</div>
    <div style="font-size:10px;color:#64748b">{{school.address}} — {{school.phone}}</div>
  </div>
  <div class="ref">
    <div class="ref-label">Reference</div>
    <div class="ref-value">{{payment.reference}}</div>
    <div style="font-size:10px;color:#64748b">{{payment.date}}</div>
  </div>
</div>

<div class="title">Recu de paiement</div>

<div class="info-grid">
  <div class="info-item"><span class="label">Eleve</span><br/><span class="value">{{student.name}}</span></div>
  <div class="info-item"><span class="label">Matricule</span><br/><span class="value">{{student.matricule}}</span></div>
  <div class="info-item"><span class="label">Classe</span><br/><span class="value">{{student.classe}}</span></div>
  <div class="info-item"><span class="label">Payeur</span><br/><span class="value">{{payer.nom}}</span></div>
</div>

<table>
  <thead><tr><th>Description</th><th style="text-align:right">Montant</th></tr></thead>
  <tbody>
    <tr><td>{{payment.typeLabel}} — {{payment.period}} {{payment.year}}</td><td style="text-align:right;font-weight:600">{{payment.montantBrut}} F</td></tr>
    {{#if payment.hasReduction}}<tr><td>Reduction ({{payment.reductionLabel}})</td><td style="text-align:right;color:#16a34a">-{{payment.reduction}} F</td></tr>{{/if}}
  </tbody>
  <tfoot>
    <tr class="total-row"><td>Total paye</td><td style="text-align:right">{{payment.montantPaye}} F</td></tr>
  </tfoot>
</table>

{{#if payment.hasDebt}}
<div style="padding:8px 12px;background:#fef3c7;border:1px solid #fde68a;margin-bottom:12px">
  <span style="font-weight:700;color:#92400e">Dette restante : {{payment.dette}} F</span>
</div>
{{/if}}

<div style="text-align:center;margin:16px 0">
  {{#if payment.hasDebt}}<span class="badge badge-yellow">Paiement partiel</span>{{/if}}
  {{#if payment.isPaid}}<span class="badge badge-green">Paye</span>{{/if}}
</div>

<div style="font-size:10px;color:#64748b;margin-top:8px">
  Mode : {{payment.modeLabel}} · Encaisse par : {{payment.encaisseParNom}}
  {{#if payment.transactionId}} · Transaction : {{payment.transactionId}}{{/if}}
</div>

<div class="footer">
  {{school.name}} — {{school.address}}<br/>
  {{#if style.footerText}}{{style.footerText}}{{/if}}
</div>
</body>
</html>`;

async function main() {
  console.log('Seeding document templates...');

  const templates = [
    {
      typeDocument: 'BULLETIN',
      nom: 'Classique',
      description: 'Design standard — tableau structuré, sobre, professionnel',
      templateHtml: BULLETIN_HTML,
      styles: DEFAULT_STYLES,
      isDefault: true,
    },
    {
      typeDocument: 'CARTE_SCOLAIRE',
      nom: 'Standard',
      description: 'Carte avec photo, QR code, informations essentielles',
      templateHtml: CARTE_HTML,
      styles: DEFAULT_STYLES,
      isDefault: true,
    },
    {
      typeDocument: 'RECU_PAIEMENT',
      nom: 'Standard',
      description: 'Reçu professionnel avec détail du paiement',
      templateHtml: RECU_HTML,
      styles: DEFAULT_STYLES,
      isDefault: true,
    },
  ];

  for (const t of templates) {
    const existing = await prisma.documentTemplate.findFirst({
      where: { tenantId: null, typeDocument: t.typeDocument, nom: t.nom },
    });
    if (existing) {
      await prisma.documentTemplate.update({
        where: { id: existing.id },
        data: { templateHtml: t.templateHtml, styles: t.styles, description: t.description, isDefault: t.isDefault },
      });
      console.log(`  Updated: ${t.typeDocument} — ${t.nom}`);
    } else {
      await prisma.documentTemplate.create({
        data: { tenantId: null, ...t },
      });
      console.log(`  Created: ${t.typeDocument} — ${t.nom}`);
    }
  }

  console.log('Done.');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
