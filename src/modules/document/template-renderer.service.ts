import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '@/config/prisma.service';

export interface TemplateStyles {
  primaryColor?: string;
  secondaryColor?: string;
  fontFamily?: string;
  logoPosition?: 'left' | 'center' | 'right';
  logoSize?: number;
  showDevise?: boolean;
  deviseText?: string;
  showCachet?: boolean;
  cachetUrl?: string;
  headerText?: string;
  footerText?: string;
  watermark?: boolean;
}

@Injectable()
export class TemplateRendererService {
  private readonly logger = new Logger(TemplateRendererService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the active template for a given tenant and document type.
   *
   * Priority:
   *   1. Tenant-specific default template
   *   2. System default template (tenantId = null)
   *   3. null (fallback to hardcoded HTML)
   */
  async resolveTemplate(
    tenantId: string,
    typeDocument: 'BULLETIN' | 'CARTE_SCOLAIRE' | 'RECU_PAIEMENT',
  ): Promise<{ html: string; styles: TemplateStyles } | null> {
    // 1. Tenant-specific default
    const tenantTemplate = await this.prisma.documentTemplate.findFirst({
      where: { tenantId, typeDocument, isDefault: true },
    });
    if (tenantTemplate) {
      return {
        html: tenantTemplate.templateHtml,
        styles: (tenantTemplate.styles as TemplateStyles) ?? {},
      };
    }

    // 2. System default
    const systemTemplate = await this.prisma.documentTemplate.findFirst({
      where: { tenantId: null, typeDocument, isDefault: true },
    });
    if (systemTemplate) {
      return {
        html: systemTemplate.templateHtml,
        styles: (systemTemplate.styles as TemplateStyles) ?? {},
      };
    }

    return null;
  }

  /**
   * Render a template by injecting variables into placeholders.
   *
   * Supports:
   *   - {{variable}} — simple replacement
   *   - {{#each items}}...{{/each}} — array iteration
   *   - {{#if condition}}...{{/if}} — conditional blocks
   */
  render(html: string, variables: Record<string, unknown>, styles?: TemplateStyles): string {
    let result = html;

    // Apply style variables
    if (styles) {
      result = result
        .replace(/\{\{style\.primaryColor\}\}/g, styles.primaryColor ?? '#2563eb')
        .replace(/\{\{style\.secondaryColor\}\}/g, styles.secondaryColor ?? '#64748b')
        .replace(/\{\{style\.fontFamily\}\}/g, styles.fontFamily ?? 'Arial, sans-serif')
        .replace(/\{\{style\.logoSize\}\}/g, String(styles.logoSize ?? 60))
        .replace(/\{\{style\.deviseText\}\}/g, styles.deviseText ?? '')
        .replace(/\{\{style\.headerText\}\}/g, styles.headerText ?? '')
        .replace(/\{\{style\.footerText\}\}/g, styles.footerText ?? '')
        .replace(/\{\{style\.cachetUrl\}\}/g, styles.cachetUrl ?? '');
    }

    // Process {{#if condition}}...{{/if}}
    result = result.replace(
      /\{\{#if\s+(\w[\w.]*)\}\}([\s\S]*?)\{\{\/if\}\}/g,
      (_, key: string, content: string) => {
        const val = this.resolveValue(key, variables);
        return val ? content : '';
      },
    );

    // Process {{#each items}}...{{/each}}
    result = result.replace(
      /\{\{#each\s+(\w[\w.]*)\}\}([\s\S]*?)\{\{\/each\}\}/g,
      (_, key: string, template: string) => {
        const items = this.resolveValue(key, variables);
        if (!Array.isArray(items)) return '';
        return items
          .map((item, index) => {
            let row = template;
            if (typeof item === 'object' && item !== null) {
              for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
                row = row.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), this.escape(v));
              }
            }
            row = row.replace(/\{\{@index\}\}/g, String(index));
            row = row.replace(/\{\{@number\}\}/g, String(index + 1));
            return row;
          })
          .join('');
      },
    );

    // Process simple {{variable}} and {{nested.path}}
    result = result.replace(/\{\{([\w.]+)\}\}/g, (_, key: string) => {
      const val = this.resolveValue(key, variables);
      return this.escape(val);
    });

    return result;
  }

  private resolveValue(path: string, obj: Record<string, unknown>): unknown {
    const parts = path.split('.');
    let current: unknown = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return '';
      if (typeof current === 'object') {
        current = (current as Record<string, unknown>)[part];
      } else {
        return '';
      }
    }
    return current;
  }

  private escape(val: unknown): string {
    if (val === null || val === undefined) return '';
    const str = String(val);
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
