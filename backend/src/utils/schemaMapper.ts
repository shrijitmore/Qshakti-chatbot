// Enhanced schema mapping utility for dynamic relationship understanding
import fs from 'fs';

export interface TableInfo {
  name: string;
  columns: Record<string, string>;
  sample_rows: any[];
  recursive_rows?: any[];
  relationships: Array<{
    column: string;
    references_table: string;
    references_column: string;
  }>;
}

export interface SchemaMap {
  tables: Record<string, TableInfo>;
  relationships: Array<{
    from_table: string;
    from_column: string;
    to_table: string;
    to_column: string;
  }>;
}

export class DynamicSchemaMapper {
  private schemaMap: SchemaMap | null = null;

  async loadSchema(jsonData: any): Promise<SchemaMap> {
    const tables: Record<string, TableInfo> = {};
    const relationships: Array<{
      from_table: string;
      from_column: string;
      to_table: string;
      to_column: string;
    }> = [];

    // Process each table in the JSON structure
    for (const [tableName, tableData] of Object.entries(jsonData)) {
      if (typeof tableData === 'object' && tableData !== null) {
        const table = tableData as any;
        
        tables[tableName] = {
          name: tableName,
          columns: table.columns || {},
          sample_rows: table.sample_rows || [],
          recursive_rows: table.recursive_rows || [],
          relationships: table.relationships || []
        };

        // Extract relationships
        if (table.relationships && Array.isArray(table.relationships)) {
          for (const rel of table.relationships) {
            relationships.push({
              from_table: tableName,
              from_column: rel.column,
              to_table: rel.references_table,
              to_column: rel.references_column
            });
          }
        }
      }
    }

    this.schemaMap = { tables, relationships };
    return this.schemaMap;
  }

  getTablesByCategory(category: string): string[] {
    if (!this.schemaMap) return [];
    
    const categories = {
      inspection: ['inspection', 'reading', 'schedule'],
      master: ['master', 'plant', 'machine', 'operation', 'item'],
      user: ['auth', 'user', 'permission'],
      admin: ['django', 'session', 'migration']
    };

    const keywords = categories[category as keyof typeof categories] || [];
    return Object.keys(this.schemaMap.tables).filter(name =>
      keywords.some(keyword => name.toLowerCase().includes(keyword.toLowerCase()))
    );
  }

  getRelatedTables(tableName: string): Array<{ table: string; via: string; type: 'foreign_key' | 'referenced_by' }> {
    if (!this.schemaMap) return [];

    const related: Array<{ table: string; via: string; type: 'foreign_key' | 'referenced_by' }> = [];

    // Find tables this table references (foreign keys)
    for (const rel of this.schemaMap.relationships) {
      if (rel.from_table === tableName) {
        related.push({
          table: rel.to_table,
          via: rel.from_column,
          type: 'foreign_key'
        });
      }
    }

    // Find tables that reference this table
    for (const rel of this.schemaMap.relationships) {
      if (rel.to_table === tableName) {
        related.push({
          table: rel.from_table,
          via: rel.from_column,
          type: 'referenced_by'
        });
      }
    }

    return related;
  }

  resolveReference(tableName: string, columnName: string, value: any): any {
    if (!this.schemaMap || !value) return null;

    // Find the relationship
    const relationship = this.schemaMap.relationships.find(rel =>
      rel.from_table === tableName && rel.from_column === columnName
    );

    if (!relationship) return null;

    // Find the referenced record
    const referencedTable = this.schemaMap.tables[relationship.to_table];
    if (!referencedTable) return null;

    // Search in both sample_rows and recursive_rows
    const allRows = [
      ...(referencedTable.sample_rows || []),
      ...(referencedTable.recursive_rows || [])
    ];

    return allRows.find(row => row[relationship.to_column] === value);
  }

  generateSchemaDocumentation(): string {
    if (!this.schemaMap) return 'No schema loaded';

    const lines: string[] = [];
    lines.push('# Database Schema Documentation\n');

    // Group tables by category
    const categories = {
      'Inspection & Quality Control': this.getTablesByCategory('inspection'),
      'Master Data': this.getTablesByCategory('master'),
      'User Management': this.getTablesByCategory('user'),
      'System Tables': this.getTablesByCategory('admin')
    };

    for (const [categoryName, tables] of Object.entries(categories)) {
      if (tables.length === 0) continue;

      lines.push(`## ${categoryName}\n`);
      
      for (const tableName of tables) {
        const table = this.schemaMap.tables[tableName];
        const related = this.getRelatedTables(tableName);
        
        lines.push(`### ${tableName}`);
        lines.push(`**Columns:** ${Object.keys(table.columns).join(', ')}`);
        lines.push(`**Records:** ${table.sample_rows.length} samples`);
        
        if (related.length > 0) {
          const fkTables = related.filter(r => r.type === 'foreign_key').map(r => `${r.table} (via ${r.via})`);
          const refTables = related.filter(r => r.type === 'referenced_by').map(r => `${r.table} (via ${r.via})`);
          
          if (fkTables.length > 0) lines.push(`**References:** ${fkTables.join(', ')}`);
          if (refTables.length > 0) lines.push(`**Referenced by:** ${refTables.join(', ')}`);
        }
        lines.push('');
      }
    }

    // Add relationship summary
    lines.push('## Relationships Summary\n');
    for (const rel of this.schemaMap.relationships) {
      lines.push(`- **${rel.from_table}**.${rel.from_column} → **${rel.to_table}**.${rel.to_column}`);
    }

    return lines.join('\n');
  }
}

export const schemaMapper = new DynamicSchemaMapper();